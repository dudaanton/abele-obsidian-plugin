/** Narrow DOM pointer adapter; camera navigation remains in the existing viewer. */
import { toScreen, toWorld } from '../drawing/camera'
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

interface InputPorts {
  enabled(): boolean
  selection(): ReadonlySet<string>
  select(ids: Set<string>): void
  multiple(): boolean
  begin(): boolean
  valid(): boolean
  complete(ops: CanvasOperation[]): void
  cancel(): void
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
export class CanvasInput implements CanvasViewerInput {
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
    const g = this.gesture
    if (!g) return
    this.gesture = null
    this.marquee = null
    if (g.active) this.ports.cancel()
    else if (g.box) this.ports.select(g.ids)
    this.viewer.draw()
  }
  validate(): void {
    if (this.gesture?.active && !this.ports.valid()) this.cancel()
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
    if (this.marquee) box(this.marquee)
  }
  destroy(): void {
    this.cancel()
    if (this.viewer.input === this) this.viewer.input = undefined
    this.overlay.remove()
  }
}
