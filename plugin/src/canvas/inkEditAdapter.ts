/** Canvas eraser/lasso previews use the same draft and history as cards and the pen. */
import { nanoid } from 'nanoid'
import { toWorld } from '../drawing/camera'
import { boxPart } from '../drawing/selection'
import { ERASER_RADIUS } from '../drawing/tools'
import { inkEntries, inkBounds, hitInk, eraseInk, lassoInk, replaceInk } from './core/ink'
import { bounds, canvasFingerprint, cloneCanvas, type CanvasGraph, type Rect } from './core/model'
import { editCanvas, type CanvasOperation } from './core/edit'
import { hitNode, selectNode } from './core/selection'
import type { InputPorts } from './input'
import type { CanvasViewer } from './Viewer'
import type { CanvasTheme } from './core/painter'

interface Gesture {
  id: number
  pen: boolean
  graph: CanvasGraph
  preview: CanvasGraph
  selected: Set<string>
  mode: 'erase' | 'partial' | 'loop' | 'move' | 'scale'
  start: [number, number]
  at: [number, number]
  loop: number[]
  box: Rect | null
  active: boolean
  ops: CanvasOperation[]
}
export function inkSelectionBounds(graph: CanvasGraph, ids: ReadonlySet<string>): Rect | null {
  const rects = [
    ...graph.nodes.filter((n) => ids.has(n.id)),
    ...inkEntries(graph)
      .filter((e) => ids.has(e.stroke.id))
      .map(inkBounds),
  ]
  return rects.length ? bounds(rects) : null
}
export class CanvasInkEditInput {
  private gesture: Gesture | null = null
  constructor(
    private readonly viewer: CanvasViewer,
    private readonly ports: InputPorts
  ) {}
  ignores(event: PointerEvent): boolean {
    return !!this.gesture?.pen && event.pointerType === 'touch'
  }
  private point(event: PointerEvent): [number, number] {
    const r = this.viewer.stage.getBoundingClientRect()
    return toWorld(this.viewer.camera, event.clientX - r.left, event.clientY - r.top)
  }
  down(event: PointerEvent): boolean {
    const tool = this.ports.tool()
    if (!['eraser', 'partial-eraser', 'lasso'].includes(tool)) return false
    const graph = this.viewer.graph,
      start = this.point(event),
      selected = new Set(this.ports.selection()),
      box = inkSelectionBounds(graph, selected),
      part = box
        ? boxPart(
            { x: box.x, y: box.y, w: box.width, h: box.height },
            ...start,
            this.viewer.camera.zoom
          )
        : 'outside'
    const mode =
      tool === 'eraser'
        ? 'erase'
        : tool === 'partial-eraser'
          ? 'partial'
          : this.ports.multiple()
            ? 'loop'
            : part === 'handle'
              ? 'scale'
              : part === 'inside'
                ? 'move'
                : 'loop'
    const g: Gesture = {
      id: event.pointerId,
      pen: event.pointerType === 'pen',
      graph,
      preview: graph,
      selected,
      mode,
      start,
      at: start,
      box,
      loop: [...start],
      active: false,
      ops: [],
    }
    this.gesture = g
    if (mode === 'erase' || mode === 'partial') {
      if (!this.ports.begin()) {
        this.gesture = null
        return true
      }
      g.active = true
      this.erase(start)
    }
    this.viewer.drawInk()
    return true
  }
  private erase(point: [number, number]): void {
    const g = this.gesture!,
      radius = ERASER_RADIUS / this.viewer.camera.zoom,
      distance = Math.hypot(point[0] - g.at[0], point[1] - g.at[1]),
      steps = Math.max(1, Math.ceil(distance / (radius / 2))),
      preview = cloneCanvas(g.preview)
    // Sweep between samples: fast mouse/finger input cannot jump over a stroke.
    for (let i = 1; i <= steps; i++) {
      const x = g.at[0] + ((point[0] - g.at[0]) * i) / steps,
        y = g.at[1] + ((point[1] - g.at[1]) * i) / steps
      for (const entry of inkEntries(preview)) {
        if (!hitInk(entry, x, y, radius)) continue
        replaceInk(preview, entry, g.mode === 'erase' ? [] : eraseInk(entry, x, y, radius, nanoid))
      }
    }
    g.preview = preview
    g.at = point
    this.viewer.graph = preview
    this.viewer.drawInk()
  }
  move(event: PointerEvent): void {
    const g = this.gesture
    if (!g || event.pointerId !== g.id) return
    if (g.active && !this.ports.valid()) {
      this.cancel()
      return
    }
    const point = this.point(event)
    if (g.mode === 'erase' || g.mode === 'partial') {
      for (const sample of event.getCoalescedEvents?.() ?? []) this.erase(this.point(sample))
      this.erase(point)
      return
    }
    g.at = point
    if (g.mode === 'loop') {
      g.loop.push(...point)
      this.viewer.drawInk()
      return
    }
    if (!g.active) {
      if (Math.hypot(point[0] - g.start[0], point[1] - g.start[1]) * this.viewer.camera.zoom < 6)
        return
      if (
        canvasFingerprint(this.viewer.graph) !== canvasFingerprint(g.graph) ||
        !this.ports.begin()
      ) {
        this.cancel()
        return
      }
      g.active = true
    }
    if (g.mode === 'move')
      g.ops = [
        { op: 'move', ids: [...g.selected], dx: point[0] - g.start[0], dy: point[1] - g.start[1] },
      ]
    else {
      const b = g.box!,
        length = b.width * b.width + b.height * b.height || 1,
        along = (p: number[]) => (p[0] - b.x) * b.width + (p[1] - b.y) * b.height,
        grip = along(g.start),
        factor = Math.max(
          0.05,
          Math.min(
            50,
            grip >= length / 2 ? along(point) / grip : 1 + (along(point) - grip) / length
          )
        )
      g.ops = [{ op: 'scale', ids: [...g.selected], x: b.x, y: b.y, factor }]
    }
    try {
      g.preview = editCanvas(g.graph, g.ops).graph
      this.viewer.graph = g.preview
      this.viewer.draw()
    } catch (error) {
      this.cancel()
      this.ports.invalid(error)
    }
  }
  up(event: PointerEvent): void {
    const g = this.gesture
    if (!g || event.pointerId !== g.id) return
    this.move(event)
    if (this.gesture !== g) return
    this.gesture = null
    if (!g.active) {
      if (canvasFingerprint(this.viewer.graph) !== canvasFingerprint(g.graph)) return
      const far =
        Math.max(
          ...g.loop
            .filter((_, i) => i % 2 === 0)
            .map((x, i) => Math.hypot(x - g.start[0], g.loop[i * 2 + 1] - g.start[1]))
        ) * this.viewer.camera.zoom
      const hit =
        [...inkEntries(g.graph)]
          .reverse()
          .find((e) => hitInk(e, ...g.at, 8 / this.viewer.camera.zoom))?.stroke.id ??
        hitNode(g.graph, ...g.at)?.id
      this.ports.select(
        far < 6
          ? selectNode(g.selected, hit ?? null, this.ports.multiple())
          : new Set([...(this.ports.multiple() ? g.selected : []), ...lassoInk(g.graph, g.loop)])
      )
    } else if (this.ports.valid() && canvasFingerprint(g.preview) !== canvasFingerprint(g.graph)) {
      if (g.mode === 'erase' || g.mode === 'partial') {
        const after = inkEntries(g.preview)
        g.ops = []
        const originals = new Map(inkEntries(g.graph).map((e) => [e.stroke.id, e]))
        for (const entry of originals.values()) {
          const kept = after.find((e) => e.stroke.id === entry.stroke.id)
          if (!kept || JSON.stringify(kept.stroke) !== JSON.stringify(entry.stroke)) {
            g.ops.push({ op: 'remove', id: entry.stroke.id })
            if (kept)
              g.ops.push({
                op: 'add_ink',
                stroke: kept.stroke,
                ...(kept.node ? { node: kept.node.id } : {}),
              })
          }
        }
        for (const entry of after)
          if (!originals.has(entry.stroke.id))
            g.ops.push({
              op: 'add_ink',
              stroke: entry.stroke,
              ...(entry.node ? { node: entry.node.id } : {}),
            })
      }
      if (g.ops.length) this.ports.complete(g.ops)
      else this.ports.cancel()
    } else this.ports.cancel()
    this.viewer.draw()
  }
  cancel(): void {
    const g = this.gesture
    if (!g) return
    this.gesture = null
    if (g.active) this.ports.cancel()
    this.viewer.draw()
  }
  validate(): void {
    if (this.gesture?.active && !this.ports.valid()) this.cancel()
  }
  paint(ctx: CanvasRenderingContext2D, theme: CanvasTheme): void {
    const g = this.gesture
    if (!g) return
    ctx.save()
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 1.5 / this.viewer.camera.zoom
    ctx.beginPath()
    if (g.mode === 'erase' || g.mode === 'partial')
      ctx.arc(...g.at, ERASER_RADIUS / this.viewer.camera.zoom, 0, Math.PI * 2)
    else if (g.mode === 'loop') {
      ctx.setLineDash([6 / this.viewer.camera.zoom, 4 / this.viewer.camera.zoom])
      for (let i = 0; i < g.loop.length; i += 2)
        if (i) ctx.lineTo(g.loop[i], g.loop[i + 1])
        else ctx.moveTo(g.loop[i], g.loop[i + 1])
      ctx.closePath()
    }
    ctx.stroke()
    ctx.restore()
  }
}
