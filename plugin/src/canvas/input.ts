/** Narrow DOM pointer adapter; camera navigation remains in the existing viewer. */
import { toScreen, toWorld } from '../drawing/camera'
import { nanoid } from 'nanoid'
import { linesOf, rawLines, segmentDistance, type CanvasLine } from './core/primitives'
import { endpoint, paintedRoute, routeSamples, sideAt, type Point } from './core/scene'
import { editCanvas } from './core/edit'
import { type CanvasOperation } from './core/edit'
import {
  canvasFingerprint,
  parentsOf,
  type CanvasGraph,
  type CanvasNode,
  type Rect,
  type Side,
} from './core/model'
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
import { CanvasInkInput } from './inkAdapter'
import { routePointer } from '../ink/route'
import { CanvasInkEditInput, inkSelectionBounds } from './inkEditAdapter'
import type { CanvasTheme } from './core/painter'

export type CanvasInputTool =
  | 'select'
  | 'connect'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'marker'
  | 'pan'
  | 'eraser'
  | 'partial-eraser'
  | 'lasso'
  | 'frame'
/** A frame drawn with a click and no drag: about two cards wide. */
export const FRAME_SIZE = { width: 480, height: 320 }
export interface InputPorts {
  /** The colour and width a pen or marker draws with now. */
  brush(tool?: 'pen' | 'marker'): { color: string; size: number }
  tool(): CanvasInputTool
  /**
   * The Pencil: which of pen and marker it draws with, which eraser its other end is, whether a
   * finger draws too once a pen has been seen, and a word that one just was.
   */
  pencil?(): { ink: 'pen' | 'marker'; eraser: 'eraser' | 'partial-eraser'; fingerDraws: boolean }
  sawPen?(): void
  enabled(): boolean
  /** The canvas is only writing the last change: a stroke may still be drawn, to add after it. */
  holds?(): boolean
  /** A stroke drawn while the last change was being written, to add once it is written. */
  hold?(op: CanvasOperation): void
  selection(): ReadonlySet<string>
  select(ids: Set<string>): void
  multiple(): boolean
  begin(): boolean
  valid(): boolean
  complete(ops: CanvasOperation[]): void
  cancel(): void
  invalid(error: unknown): void
  /**
   * A connection pulled from a card's edge and let go over empty canvas: the host asks what to
   * make there. The gesture's draft stays open until it answers.
   */
  dropped?(drop: CanvasDrop): void
  /** Two presses in one place: what was pressed opens for writing, or a card is made there. */
  double?(target: CanvasDouble): void
}
/** What a double press landed on. */
export type CanvasDouble =
  | { kind: 'node' | 'frame' | 'connection'; id: string }
  | { kind: 'empty'; point: Point }
/** Two presses this close in time and on the screen are one double press. */
const DOUBLE_MS = 400,
  DOUBLE_PX = 8
/** Where a connection was let go over nothing, and the card edge it came from. */
export interface CanvasDrop {
  source: string
  side: Side
  /** In the canvas's own space, and on the screen for a menu to open at. */
  point: Point
  screen: Point
}
const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
export const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
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
  /** The edge of the source card it was pulled from, when pulled from one of its points. */
  fromSide: Side | null
  /** The card under the pointer and the edge of it the connection would stick to. */
  target: string | null
  toSide: Side | null
  end: 'from' | 'to' | null
  line: CanvasLine | null
  creating: boolean
  start: Point
  screen: Point
  point: Point
  active: boolean
}
const roundRect = (r: Rect): Rect => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  width: Math.round(r.width),
  height: Math.round(r.height),
})
/**
 * The smallest frame, not itself carried, that would hold a carried card whole once it is let
 * go; a frame it already sits in still counts, so the light shows where it stays as well.
 */
export function landingFrame(
  graph: CanvasGraph,
  ids: ReadonlySet<string>,
  moving: ReadonlySet<string>
): string | null {
  const carried = graph.nodes.filter((n) => ids.has(n.id))
  if (!carried.length) return null
  const holds = (g: Rect, n: Rect) =>
    n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height
  const frames = graph.nodes
    .filter((n) => n.type === 'group' && !moving.has(n.id) && carried.every((c) => holds(n, c)))
    .sort((a, b) => a.width * a.height - b.width * b.height)
  return frames[0]?.id ?? null
}
/** A frame drawn around a region takes in what lies whole inside it, nested frames intact. */
export function frameOps(graph: CanvasGraph, rect: Rect): CanvasOperation[] {
  const id = nanoid(),
    inside = new Set(nodesInBox(graph, rect)),
    parents = parentsOf(graph),
    top = [...inside].filter((n) => !inside.has(parents.get(n) ?? ''))
  if (!top.length) return [{ op: 'add_node', node: { id, kind: 'group', label: 'Frame', ...rect } }]
  return [
    { op: 'group', id, label: 'Frame', ids: top },
    { op: 'update', id, patch: { ...rect } },
  ]
}
export class CanvasInput implements CanvasViewerInput {
  private readonly ink: CanvasInkInput
  private readonly inkEdit: CanvasInkEditInput
  private connection: ConnectionGesture | null = null
  private gesture: Gesture | null = null
  private readonly overlay: HTMLElement
  private marquee: Rect | null = null
  /** A frame being drawn with the Frame tool, from where the pointer went down. */
  private framing: { start: [number, number]; screen: [number, number]; rect: Rect | null } | null =
    null
  /** The frame a card being carried would land in, lit while it is over it. */
  private dropFrame: string | null = null
  /** The card under a mouse that is not pressed, which shows its connection points. */
  private hovered: string | null = null
  /** Where a pen hovers over the screen without touching it, in screen space. */
  private penHover: [number, number] | null = null
  /** Once a pen has touched the canvas, a finger moves it rather than drawing. */
  private penSeen = false
  /** The last press with Select that has not become a drag, for a second press to pair with. */
  private lastPress: { time: number; x: number; y: number } | null = null
  constructor(
    private readonly viewer: CanvasViewer,
    private readonly ports: InputPorts
  ) {
    this.ink = new CanvasInkInput(viewer, ports)
    this.inkEdit = new CanvasInkEditInput(viewer, ports)
    this.overlay = viewer.el.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    this.overlay.className = 'abele-canvas-selection-layer'
    viewer.stage.append(this.overlay)
    viewer.input = this
  }
  private point(event: PointerEvent): [number, number] {
    const rect = this.viewer.stage.getBoundingClientRect()
    return toWorld(this.viewer.camera, event.clientX - rect.left, event.clientY - rect.top)
  }
  ignores(event: PointerEvent): boolean {
    return this.ink.ignores(event) || this.inkEdit.ignores(event)
  }
  /** A stroke kept while the last change was written is on the canvas now, or given up. */
  released(id: string): void {
    this.ink.release(id)
  }
  paintInk(ctx: CanvasRenderingContext2D, theme: CanvasTheme): void {
    this.ink.paint(ctx, theme)
    this.inkEdit.paint(ctx, theme)
  }
  /** What a pointer coming down would draw with, if it draws at all. */
  private inkFor(event: PointerEvent): 'pen' | 'marker' | null {
    const tool = this.ports.tool(),
      pencil = this.ports.pencil?.()
    if (event.pointerType === 'pen' && pencil) {
      if (routePointer({ finger: false, penDown: false }, event) === 'erase') return null
      if (tool === 'eraser' || tool === 'partial-eraser' || tool === 'lasso') return null
      return tool === 'pen' || tool === 'marker' ? tool : pencil.ink
    }
    if (tool !== 'pen' && tool !== 'marker') return null
    if (event.pointerType === 'touch' && this.penSeen && !pencil?.fingerDraws) return null
    return tool
  }
  down(event: PointerEvent): boolean {
    if (event.altKey || event.button !== 0) return false
    if (!this.ports.enabled()) {
      // While the last change is being written, a stroke is still drawn, and added after it.
      const ink = this.ports.holds?.() ? this.inkFor(event) : null
      return ink ? this.ink.down(event, ink, true) : false
    }
    const tool = this.ports.tool(),
      pencil = this.ports.pencil?.()
    this.penHover = null
    if (event.pointerType === 'pen' && pencil) {
      // The Pencil draws whatever tool is in hand; its other end erases.
      if (!this.penSeen) {
        this.penSeen = true
        this.ports.sawPen?.()
      }
      if (routePointer({ finger: false, penDown: false }, event) === 'erase')
        return this.inkEdit.down(event, pencil.eraser)
      if (tool !== 'eraser' && tool !== 'partial-eraser' && tool !== 'lasso')
        return this.ink.down(event, tool === 'pen' || tool === 'marker' ? tool : pencil.ink)
    }
    if (tool === 'pen' || tool === 'marker') {
      // With a pen about, a finger moves the canvas, and a hand resting on it does nothing.
      if (event.pointerType === 'touch' && this.penSeen && !pencil?.fingerDraws) return false
      return this.ink.down(event)
    }
    if (this.inkEdit.down(event)) return true
    if (this.ports.tool() === 'pan') return false
    if (this.ports.tool() === 'frame') {
      this.framing = {
        start: this.point(event),
        screen: [event.clientX, event.clientY],
        rect: null,
      }
      return true
    }
    if (this.doubleDown(event)) return true
    if (this.connectionDown(event)) return true
    if (this.ports.tool() !== 'select') return false
    const graph = this.viewer.graph,
      [x, y] = this.point(event),
      selected = this.ports.selection(),
      // A frame's name stands over its corner, outside its box, and still picks and carries it.
      labelled = (event.target as Element | null)?.closest?.('[data-frame-id]'),
      named = labelled
        ? graph.nodes.find((n) => n.id === (labelled as HTMLElement).dataset.frameId)
        : undefined,
      single = selected.size === 1 ? graph.nodes.find((n) => selected.has(n.id)) : null,
      multiple = event.shiftKey || this.ports.multiple(),
      corner =
        !multiple && single
          ? hitResize(single, x, y, this.viewer.camera.zoom, event.pointerType !== 'mouse')
          : null,
      node = corner ? single : (named ?? hitNode(graph, x, y))
    if (!node && !multiple && event.pointerType !== 'mouse') {
      this.ports.select(new Set())
      return false // A finger on empty space moves the canvas; a mouse draws a box there.
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
    this.ink.move(event)
    this.inkEdit.move(event)
    if (this.connection) {
      this.connectionMove(event)
      return
    }
    if (this.framing) {
      const f = this.framing
      if (!f.rect && Math.hypot(event.clientX - f.screen[0], event.clientY - f.screen[1]) < 6)
        return
      const [x, y] = this.point(event)
      f.rect = {
        x: Math.min(x, f.start[0]),
        y: Math.min(y, f.start[1]),
        width: Math.abs(x - f.start[0]),
        height: Math.abs(y - f.start[1]),
      }
      this.ports.select(new Set(nodesInBox(this.viewer.graph, f.rect)))
      this.viewer.draw()
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
      this.lastPress = null
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
      this.lastPress = null
    }
    let preview: CanvasGraph
    if (g.corner) {
      const node = g.graph.nodes.find((n) => n.id === g.node),
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
    this.dropFrame = landingFrame(preview, g.ids, g.moving)
    // Avoid validation, asset reloads and full session cloning on every pointer event.
    this.viewer.graph = preview
    this.viewer.draw()
  }
  up(event: PointerEvent): void {
    this.ink.up(event)
    this.inkEdit.up(event)
    if (this.connection) {
      this.connectionUp(event)
      return
    }
    if (this.framing) {
      this.move(event)
      const f = this.framing
      this.framing = null
      const rect =
        f.rect && f.rect.width >= 40 && f.rect.height >= 40
          ? f.rect
          : {
              x: f.start[0] - FRAME_SIZE.width / 2,
              y: f.start[1] - FRAME_SIZE.height / 2,
              ...FRAME_SIZE,
            }
      if (this.ports.begin()) this.ports.complete(frameOps(this.viewer.graph, roundRect(rect)))
      this.viewer.draw()
      return
    }
    const g = this.gesture
    if (!g) return
    this.move(event)
    if (this.gesture !== g) return
    this.gesture = null
    this.marquee = null
    this.dropFrame = null
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
    this.ink.cancel()
    this.inkEdit.cancel()
    if (this.connection) {
      const g = this.connection
      this.connection = null
      if (g.active) this.ports.cancel()
      this.viewer.draw()
    }
    if (this.framing) {
      this.framing = null
      this.viewer.draw()
    }
    const g = this.gesture
    if (!g) return
    this.gesture = null
    this.marquee = null
    this.dropFrame = null
    if (g.active) this.ports.cancel()
    else if (g.box) this.ports.select(g.ids)
    this.viewer.draw()
  }
  validate(): void {
    this.ink.validate()
    this.inkEdit.validate()
    if ((this.gesture?.active || this.connection?.active) && !this.ports.valid()) this.cancel()
  }
  paint(): void {
    this.overlay.replaceChildren()
    if (this.viewer.step !== null) return
    const graph = this.viewer.graph,
      selected = this.ports.selection(),
      single = selected.size === 1
    const box = (rect: Rect) => {
      const el = this.overlay.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div'),
        [x, y] = toScreen(this.viewer.camera, rect.x, rect.y)
      el.className = 'abele-canvas-selection-box'
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.width = `${rect.width * this.viewer.camera.zoom}px`
      el.style.height = `${rect.height * this.viewer.camera.zoom}px`
      this.overlay.append(el)
    }
    if (this.ports.tool() === 'lasso') {
      const rect = inkSelectionBounds(graph, selected)
      if (rect) {
        box(rect)
        const handle = this.overlay.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'div'
          ),
          [x, y] = toScreen(this.viewer.camera, rect.x + rect.width, rect.y + rect.height)
        handle.className = 'abele-canvas-resize-handle'
        handle.setAttribute('aria-label', 'Scale canvas selection')
        handle.style.left = `${x}px`
        handle.style.top = `${y}px`
        this.overlay.append(handle)
      }
      return
    }
    for (const node of graph.nodes.filter((n) => selected.has(n.id))) {
      box(node)
      if (!single || !this.ports.enabled()) continue
      for (const corner of RESIZE_CORNERS) {
        const handle = this.overlay.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'div'
          ),
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
          ),
          [x, y] = toScreen(this.viewer.camera, point.x, point.y)
        handle.className = 'abele-canvas-resize-handle abele-canvas-endpoint-handle'
        handle.dataset.end = end
        handle.setAttribute('aria-label', `Reconnect ${end} endpoint`)
        handle.style.left = `${x}px`
        handle.style.top = `${y}px`
        this.overlay.append(handle)
      }
    }
    // The four points on a card's edges a connection is pulled from, and while one is pulled,
    // the points of the card it would stick to, the nearest one lit.
    const pulling = this.connection?.active && this.connection.source ? this.connection : null
    const pointsOf = (node: CanvasNode, lit: Side | null) => {
      for (const side of SIDES) {
        const el = this.overlay.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'div'
          ),
          p = endpoint(node, side),
          [x, y] = toScreen(this.viewer.camera, p.x, p.y)
        el.className = 'abele-canvas-connect-point'
        // A small card far zoomed out keeps its points smaller than itself; a finger still
        // reaches them as far as before.
        el.style.setProperty(
          '--abele-point-limit',
          `${Math.max(8, (Math.min(node.width, node.height) * this.viewer.camera.zoom) / 3)}px`
        )
        if (side === lit) el.classList.add('is-active')
        el.dataset.side = side
        el.setAttribute('aria-label', `Connect from the ${side} edge`)
        el.style.left = `${x}px`
        el.style.top = `${y}px`
        this.overlay.append(el)
      }
    }
    if (pulling) {
      const target = pulling.target && graph.nodes.find((n) => n.id === pulling.target)
      if (target) {
        box(target)
        pointsOf(target, pulling.toSide)
      }
    } else if (!this.gesture?.active) {
      const card = this.pointsCard()
      if (card) pointsOf(card, null)
    }
    if (this.marquee) box(this.marquee)
    if (this.penHover && this.ports.pencil) {
      const tool = this.ports.tool(),
        ink = tool === 'pen' || tool === 'marker' ? tool : this.ports.pencil().ink,
        size = Math.max(6, this.ports.brush(ink).size * this.viewer.camera.zoom),
        ring = this.overlay.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div')
      ring.className = 'abele-canvas-pen-hover'
      ring.style.left = `${this.penHover[0]}px`
      ring.style.top = `${this.penHover[1]}px`
      ring.style.width = ring.style.height = `${size}px`
      this.overlay.append(ring)
    }
    if (this.framing?.rect) {
      box(this.framing.rect)
      this.overlay.lastElementChild?.classList.add('abele-canvas-frame-draft')
    }
    const target = this.dropFrame && graph.nodes.find((n) => n.id === this.dropFrame)
    if (target) {
      box(target)
      this.overlay.lastElementChild?.classList.add('abele-canvas-frame-target')
    }
  }
  /** The frame a carried card would land in, for a host that lights it in its own way. */
  landing(): string | null {
    return this.dropFrame
  }
  /** A mouse moving over the canvas with nothing pressed: the card under it shows its points. */
  hover(event: PointerEvent): void {
    if (event.pointerType === 'pen') {
      // A pen held over the screen shows the size of its tip where it would touch.
      const r = this.viewer.stage.getBoundingClientRect()
      this.penHover = [event.clientX - r.left, event.clientY - r.top]
      this.viewer.draw()
      return
    }
    const tool = this.ports.tool()
    if (event.pointerType !== 'mouse' || (tool !== 'select' && tool !== 'connect')) return
    const [x, y] = this.point(event),
      over = hitNode(this.viewer.graph, x, y),
      near = this.hovered ? this.pointHit(x, y, false) : null,
      id = near ? near.node.id : over && over.type !== 'group' ? over.id : null
    if (id === this.hovered) return
    this.hovered = id
    this.viewer.draw()
  }
  /** The card whose edges show their points: the one under the mouse, else the one picked. */
  private pointsCard(): CanvasNode | null {
    const tool = this.ports.tool()
    if ((tool !== 'select' && tool !== 'connect') || !this.ports.enabled()) return null
    const graph = this.viewer.graph,
      selected = this.ports.selection(),
      id = this.hovered ?? (selected.size === 1 ? [...selected][0] : null)
    const node = graph.nodes.find((n) => n.id === id)
    return node && node.type !== 'group' ? node : null
  }
  /** A point on a card's edge within reach: a finger's reach is wider than a mouse's. */
  private pointHit(x: number, y: number, touch: boolean): { node: CanvasNode; side: Side } | null {
    const node = this.pointsCard()
    if (!node) return null
    const reach = (touch ? 22 : 10) / this.viewer.camera.zoom
    const side = SIDES.find((s) => {
      const p = endpoint(node, s)
      return Math.hypot(x - p.x, y - p.y) <= reach
    })
    return side ? { node, side } : null
  }
  /** The connection or free line under a point, the one drawn last winning. */
  private connectionAt(point: Point, tolerance: number): string | null {
    const graph = this.viewer.graph
    const line = [...linesOf(graph)]
      .reverse()
      .find((l) => segmentDistance(point, l.from, l.to) <= tolerance)
    if (line) return line.id
    const edge = [...graph.edges].reverse().find((e) => {
      const samples = routeSamples(paintedRoute(e, graph))
      return samples.slice(1).some((p, i) => segmentDistance(point, samples[i], p) <= tolerance)
    })
    return edge?.id ?? null
  }
  /** A second press with Select close to the first: the host opens what it landed on. */
  private doubleDown(event: PointerEvent): boolean {
    if (this.ports.tool() !== 'select' || event.shiftKey || !this.ports.double) return false
    const now = Date.now(),
      last = this.lastPress
    this.lastPress = { time: now, x: event.clientX, y: event.clientY }
    if (
      !last ||
      now - last.time > DOUBLE_MS ||
      Math.hypot(event.clientX - last.x, event.clientY - last.y) > DOUBLE_PX
    )
      return false
    this.lastPress = null
    const graph = this.viewer.graph,
      [x, y] = this.point(event),
      labelled = (event.target as Element | null)?.closest?.<HTMLElement>('[data-frame-id]'),
      over = hitNode(graph, x, y),
      tolerance = (event.pointerType === 'mouse' ? 10 : 22) / this.viewer.camera.zoom,
      connection = this.connectionAt({ x, y }, tolerance)
    const target: CanvasDouble = labelled?.dataset.frameId
      ? { kind: 'frame', id: labelled.dataset.frameId }
      : over && over.type !== 'group'
        ? { kind: 'node', id: over.id }
        : connection
          ? { kind: 'connection', id: connection }
          : over
            ? { kind: 'frame', id: over.id }
            : { kind: 'empty', point: { x: Math.round(x), y: Math.round(y) } }
    this.ports.double(target)
    return true
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
      fromSide: Side | null = null,
      end: 'from' | 'to' | null = null,
      line: CanvasLine | null = null,
      creating = tool !== 'select'
    const pulled = this.pointHit(x, y, event.pointerType !== 'mouse')
    if (pulled) {
      // Pulled from a point on a card's edge: a new connection, whatever the tool.
      source = pulled.node.id
      fromSide = pulled.side
      creating = true
    } else if (tool === 'connect') {
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
        const hit = this.connectionAt(point, tolerance)
        if (!hit) return false
        id = hit
        line = linesOf(graph).find((l) => l.id === hit) ?? null
      }
      this.ports.select(new Set([id]))
      creating = false
    }
    this.connection = {
      graph,
      id,
      source,
      fromSide,
      target: null,
      toSide: null,
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
      this.lastPress = null
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
        over = g.source ? hitNode(g.graph, x, y) : null,
        target = over && over.id !== g.source && over.type !== 'group' ? over : null
      // Over another card, a line pulled from an edge point sticks to the target's edge nearest
      // the pointer; one dragged from a card's body to the edge facing where it started.
      g.target = target?.id ?? null
      g.toSide = target ? sideAt(target, g.fromSide ? g.point : g.start) : null
      const from = node
          ? endpoint(node, g.fromSide ?? sideAt(node, g.point))
          : g.end === 'from'
            ? g.point
            : (points[0] ?? g.start),
        to =
          g.end === 'from'
            ? points[points.length - 1]
            : target && g.toSide
              ? endpoint(target, g.toSide)
              : g.point,
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
      // A connection being pulled out is drawn as picked, in the accent, until it is let go.
      if (g.creating && !this.ports.selection().has(g.id)) this.ports.select(new Set([g.id]))
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
        const target = g.source
          ? g.graph.nodes.find((n) => n.id === g.target)
          : hitNode(g.graph, g.point.x, g.point.y)
        const home = hitNode(g.graph, g.point.x, g.point.y)?.id === g.source
        if (!target && !home && g.source && g.fromSide && this.ports.dropped) {
          // Let go over nothing: the host offers what to make there; the draft waits for it.
          this.ports.dropped({
            source: g.source,
            side: g.fromSide,
            point: g.point,
            screen: { x: event.clientX, y: event.clientY },
          })
          this.viewer.draw()
          return
        }
        if (target) {
          if (g.source)
            ops = [
              {
                op: 'connect',
                edge: {
                  id: g.id,
                  fromNode: g.source,
                  ...(g.fromSide ? { fromSide: g.fromSide } : {}),
                  toNode: target.id,
                  toSide: g.toSide ?? sideAt(target, g.start),
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
