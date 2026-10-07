/** Narrow DOM pointer adapter; camera navigation remains in the existing viewer. */
import { toScreen, toWorld } from '../drawing/camera'
import { nanoid } from 'nanoid'
import { linesOf, rawLines, segmentDistance, type CanvasLine } from './core/primitives'
import { endpoint, paintedRoute, routeSamples, sideAt, type Point } from './core/scene'
import { editCanvas } from './core/edit'
import { type CanvasOperation } from './core/edit'
import { canvasFingerprint, type CanvasGraph, type Rect } from './core/model'
import {
  cornerPoint,
  hitNode,
  hitResize,
  moveIds,
  movePreview,
  nodesInBox,
  RESIZE_CORNERS,
  resizeRect,
  selectNode,
  type ResizeCorner,
} from './core/selection'
import type { CanvasViewer, CanvasViewerInput } from './Viewer'

export type CanvasInputTool = 'select' | 'connect' | 'line' | 'arrow'
interface InputPorts {
  tool(): CanvasInputTool
  enabled(): boolean
  selection(): ReadonlySet<string>
  select(ids: Set<string>): void
  multiple(): boolean
  begin(): boolean
  valid(): boolean
  complete(ops: CanvasOperation[]): void
  cancel(): void
  invalid(error: unknown): void
}
interface Gesture {
  graph: CanvasGraph
  ids: Set<string>
  moving: Set<string>
  node: string | null
  corner: ResizeCorner | null
  box: boolean
  additive: boolean
  start: [number, number]
  screen: [number, number]
  active: boolean
  ops: CanvasOperation[]
}
interface ConnectionGesture {
  graph: CanvasGraph
  id: string
  source: string | null
  end: 'from' | 'to' | null
  line: CanvasLine | null
  creating: boolean
  start: Point
  screen: Point
  point: Point
  active: boolean
}
export class CanvasInput implements CanvasViewerInput {
  private connection: ConnectionGesture | null = null
  private gesture: Gesture | null = null
  private readonly overlay: HTMLElement
  private marquee: Rect | null = null
  constructor(
    private readonly viewer: CanvasViewer,
    private readonly ports: InputPorts
  ) {
    this.overlay = viewer.el.ownerDocument.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'div'
    ) as HTMLElement
    this.overlay.className = 'abele-canvas-selection-layer'
    viewer.stage.append(this.overlay)
    viewer.input = this
  }
  private point(event: PointerEvent): [number, number] {
    const rect = this.viewer.stage.getBoundingClientRect()
    return toWorld(this.viewer.camera, event.clientX - rect.left, event.clientY - rect.top)
  }
  down(event: PointerEvent): boolean {
    if (!this.ports.enabled() || event.altKey || event.button !== 0) return false
    if (this.connectionDown(event)) return true
    if (this.ports.tool() !== 'select') return false
    const graph = this.viewer.graph,
      [x, y] = this.point(event),
      selected = this.ports.selection(),
      single = selected.size === 1 ? graph.nodes.find((n) => selected.has(n.id)) : null,
      multiple = event.shiftKey || this.ports.multiple(),
      corner =
        !multiple && single
          ? hitResize(single, x, y, this.viewer.camera.zoom, event.pointerType !== 'mouse')
          : null,
      node = corner ? single : hitNode(graph, x, y)
    if (!node && !multiple) {
      this.ports.select(new Set())
      return false // Empty space still pans.
    }
    if (!corner && (multiple || !node || !selected.has(node.id)))
      this.ports.select(selectNode(selected, node?.id ?? null, multiple))
    const ids = new Set(this.ports.selection())
    this.gesture = {
      graph,
      ids,
      moving: moveIds(graph, ids),
      node: node?.id ?? null,
      corner,
      box: !node,
      additive: multiple && !!node,
      start: [x, y],
      screen: [event.clientX, event.clientY],
      active: false,
      ops: [],
    }
    return true
  }
  move(event: PointerEvent): void {
    if (this.connection) {
      this.connectionMove(event)
      return
    }
    const g = this.gesture
    if (!g || g.additive) return
    if (g.active && !this.ports.valid()) {
      this.cancel()
      return
    }
    if (!g.active && Math.hypot(event.clientX - g.screen[0], event.clientY - g.screen[1]) < 6)
      return
    const [x, y] = this.point(event),
      dx = x - g.start[0],
      dy = y - g.start[1]
    if (g.box) {
      this.marquee = {
        x: Math.min(x, g.start[0]),
        y: Math.min(y, g.start[1]),
        width: Math.abs(dx),
        height: Math.abs(dy),
      }
      this.ports.select(new Set([...g.ids, ...nodesInBox(g.graph, this.marquee)]))
      this.viewer.draw()
      return
    }
    if (!g.active) {
      // Selection alone does not reserve a writer. Refuse a scene changed since pointer-down
      // before deriving resize coordinates from that old scene against a newer baseline.
      if (canvasFingerprint(this.viewer.graph) !== canvasFingerprint(g.graph)) {
        this.cancel()
        return
      }
      if (!this.ports.begin()) {
        this.cancel()
        return
      }
      g.active = true
    }
    let preview: CanvasGraph
    if (g.corner) {
      const node = g.graph.nodes.find((n) => n.id === g.node)!,
        rect = resizeRect(node, g.corner, dx, dy)
      preview = {
        ...g.graph,
        nodes: g.graph.nodes.map((n) => (n.id === node.id ? { ...n, ...rect } : n)),
      }
      g.ops = [{ op: 'update', id: node.id, patch: { ...rect } }]
    } else {
      preview = movePreview(g.graph, g.moving, dx, dy)
      g.ops = [{ op: 'move', ids: [...g.ids], dx, dy }]
    }
    // Avoid validation, asset reloads and full session cloning on every pointer event.
    this.viewer.graph = preview
    this.viewer.draw()
  }
  up(event: PointerEvent): void {
    if (this.connection) {
      this.connectionUp(event)
      return
    }
    const g = this.gesture
    if (!g) return
    this.move(event)
    if (this.gesture !== g) return
    this.gesture = null
    this.marquee = null
    if (g.active) {
      if (
        this.ports.valid() &&
        g.ops.length &&
        canvasFingerprint(this.viewer.graph) !== canvasFingerprint(g.graph)
      )
        this.ports.complete(g.ops)
      else this.ports.cancel()
    }
    this.viewer.draw()
  }
  cancel(): void {
    if (this.connection) {
      const g = this.connection
      this.connection = null
      if (g.active) this.ports.cancel()
      this.viewer.draw()
    }
    const g = this.gesture
    if (!g) return
    this.gesture = null
    this.marquee = null
    if (g.active) this.ports.cancel()
    else if (g.box) this.ports.select(g.ids)
    this.viewer.draw()
  }
  validate(): void {
    if ((this.gesture?.active || this.connection?.active) && !this.ports.valid()) this.cancel()
  }
  paint(): void {
    this.overlay.replaceChildren()
    if (this.viewer.step !== null) return
    const graph = this.viewer.graph,
      selected = this.ports.selection(),
      single = selected.size === 1
    const box = (rect: Rect) => {
      const el = this.overlay.ownerDocument.createElementNS(
          'http://www.w3.org/1999/xhtml',
          'div'
        ) as HTMLElement,
        [x, y] = toScreen(this.viewer.camera, rect.x, rect.y)
      el.className = 'abele-canvas-selection-box'
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.width = `${rect.width * this.viewer.camera.zoom}px`
      el.style.height = `${rect.height * this.viewer.camera.zoom}px`
      this.overlay.append(el)
    }
    for (const node of graph.nodes.filter((n) => selected.has(n.id))) {
      box(node)
      if (!single || !this.ports.enabled()) continue
      for (const corner of RESIZE_CORNERS) {
        const handle = this.overlay.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'div'
          ) as HTMLElement,
          [wx, wy] = cornerPoint(node, corner),
          [x, y] = toScreen(this.viewer.camera, wx, wy)
        handle.className = 'abele-canvas-resize-handle'
        handle.dataset.corner = corner
        handle.setAttribute('aria-label', `Resize ${corner} corner`)
        handle.style.left = `${x}px`
        handle.style.top = `${y}px`
        this.overlay.append(handle)
      }
    }
    const edge = graph.edges.find((e) => selected.has(e.id)),
      line = linesOf(graph).find((l) => selected.has(l.id)),
      points = edge ? paintedRoute(edge, graph).points : line ? [line.from, line.to] : []
    if (single && points.length && this.ports.enabled()) {
      for (const [end, point] of [
        ['from', points[0]],
        ['to', points[points.length - 1]],
      ] as const) {
        const handle = this.overlay.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'div'
          ) as HTMLElement,
          [x, y] = toScreen(this.viewer.camera, point.x, point.y)
        handle.className = 'abele-canvas-resize-handle abele-canvas-endpoint-handle'
        handle.dataset.end = end
        handle.setAttribute('aria-label', `Reconnect ${end} endpoint`)
        handle.style.left = `${x}px`
        handle.style.top = `${y}px`
        this.overlay.append(handle)
      }
    }
    if (this.marquee) box(this.marquee)
  }
  private connectionDown(event: PointerEvent): boolean {
    const graph = this.viewer.graph,
      [x, y] = this.point(event),
      point = { x, y },
      tool = this.ports.tool(),
      selected = this.ports.selection(),
      tolerance = (event.pointerType === 'mouse' ? 10 : 22) / this.viewer.camera.zoom
    let id = nanoid(),
      source: string | null = null,
      end: 'from' | 'to' | null = null,
      line: CanvasLine | null = null,
      creating = tool !== 'select'
    if (tool === 'connect') {
      const node = hitNode(graph, x, y)
      if (!node) return false
      source = node.id
    } else if (tool === 'select') {
      const edge = selected.size === 1 ? graph.edges.find((e) => selected.has(e.id)) : undefined,
        selectedLine =
          selected.size === 1 ? linesOf(graph).find((l) => selected.has(l.id)) : undefined,
        points = edge
          ? paintedRoute(edge, graph).points
          : selectedLine
            ? [selectedLine.from, selectedLine.to]
            : []
      if (points.length) {
        if (Math.hypot(x - points[0].x, y - points[0].y) <= tolerance) end = 'from'
        else if (
          Math.hypot(x - points[points.length - 1].x, y - points[points.length - 1].y) <= tolerance
        )
          end = 'to'
      }
      if (end) {
        id = (edge ?? selectedLine).id
        line = selectedLine ?? null
      } else {
        // Bodies of cards win over connections underneath them; selected endpoint handles win above.
        const card = hitNode(graph, x, y)
        if (card && card.type !== 'group') return false
        line =
          [...linesOf(graph)]
            .reverse()
            .find((l) => segmentDistance(point, l.from, l.to) <= tolerance) ?? null
        const hit =
          line ??
          [...graph.edges].reverse().find((e) => {
            const samples = routeSamples(paintedRoute(e, graph))
            return samples
              .slice(1)
              .some((p, i) => segmentDistance(point, samples[i], p) <= tolerance)
          })
        if (!hit) return false
        id = hit.id
      }
      this.ports.select(new Set([id]))
      creating = false
    }
    this.connection = {
      graph,
      id,
      source,
      end,
      line,
      creating,
      start: point,
      point,
      screen: { x: event.clientX, y: event.clientY },
      active: false,
    }
    return true
  }
  private connectionMove(event: PointerEvent): void {
    const g = this.connection
    if (!g || (!g.creating && !g.end && !g.line)) return // Edge body tap selects, never moves cards.
    if (g.active && !this.ports.valid()) {
      this.cancel()
      return
    }
    if (!g.active) {
      if (Math.hypot(event.clientX - g.screen.x, event.clientY - g.screen.y) < 6) return
      if (
        canvasFingerprint(this.viewer.graph) !== canvasFingerprint(g.graph) ||
        !this.ports.begin()
      ) {
        this.cancel()
        return
      }
      g.active = true
    }
    const [x, y] = this.point(event)
    g.point = { x, y }
    if (g.line) {
      const patch = g.end
        ? { [g.end]: g.point }
        : {
            from: { x: g.line.from.x + x - g.start.x, y: g.line.from.y + y - g.start.y },
            to: { x: g.line.to.x + x - g.start.x, y: g.line.to.y + y - g.start.y },
          }
      // Zero-length endpoint previews are allowed visually; completion validates the operation.
      this.viewer.graph = {
        ...g.graph,
        abele: {
          ...g.graph.abele,
          lines: rawLines(g.graph).map((l) =>
            (l as CanvasLine)?.id === g.id ? { ...g.line, ...patch } : l
          ),
        },
      }
    } else {
      const edge = g.graph.edges.find((e) => e.id === g.id),
        node = g.source ? g.graph.nodes.find((n) => n.id === g.source) : undefined,
        points = edge ? paintedRoute(edge, g.graph).points : [],
        from = node
          ? endpoint(node, sideAt(node, g.point))
          : g.end === 'from'
            ? g.point
            : (points[0] ?? g.start),
        to = g.end === 'from' ? points[points.length - 1] : g.point,
        preview: CanvasLine = {
          version: 1,
          id: g.id,
          from,
          to,
          toEnd: this.ports.tool() === 'line' ? 'none' : 'arrow',
        }
      this.viewer.graph = {
        ...g.graph,
        edges: g.graph.edges.filter((e) => e.id !== g.id),
        abele: { ...g.graph.abele, lines: [...rawLines(g.graph), preview] },
      }
    }
    this.viewer.draw()
  }
  private connectionUp(event: PointerEvent): void {
    const g = this.connection
    this.connectionMove(event)
    if (!g || this.connection !== g) return
    this.connection = null
    if (!g.active) {
      this.viewer.draw()
      return
    }
    let ops: CanvasOperation[] = []
    if (this.ports.valid()) {
      if (g.line) {
        const changed = linesOf(this.viewer.graph).find((l) => l.id === g.id)
        if (changed && canvasFingerprint(this.viewer.graph) !== canvasFingerprint(g.graph))
          ops = [{ op: 'update', id: g.id, patch: { from: changed.from, to: changed.to } }]
      } else if (g.source || g.end) {
        const target = hitNode(g.graph, g.point.x, g.point.y)
        if (target) {
          if (g.source)
            ops = [
              {
                op: 'connect',
                edge: {
                  id: g.id,
                  fromNode: g.source,
                  toNode: target.id,
                  toSide: sideAt(target, g.start),
                },
              },
            ]
          else
            ops = [
              {
                op: 'update',
                id: g.id,
                patch: {
                  [g.end === 'from' ? 'fromNode' : 'toNode']: target.id,
                  [g.end === 'from' ? 'fromSide' : 'toSide']: sideAt(target, g.point),
                },
              },
            ]
        }
      } else {
        const line = linesOf(this.viewer.graph).find((l) => l.id === g.id)
        if (line) ops = [{ op: 'add_line', line }]
      }
      try {
        if (
          ops.length &&
          canvasFingerprint(editCanvas(g.graph, ops).graph) === canvasFingerprint(g.graph)
        )
          ops = []
      } catch (error) {
        this.ports.cancel()
        this.ports.invalid(error)
        this.viewer.draw()
        return
      }
    }
    if (ops.length) {
      this.ports.select(new Set([g.id]))
      this.ports.complete(ops)
    } else this.ports.cancel()
    this.viewer.draw()
  }
  destroy(): void {
    this.cancel()
    if (this.viewer.input === this) this.viewer.input = undefined
    this.overlay.remove()
  }
}
