/** Pointer sampling only; one completed stroke uses the editor's existing draft/history. */
import { nanoid } from 'nanoid'
import { toWorld } from '../drawing/camera'
import { roundPoint } from '../ink/stroke'
import { routePointer } from '../ink/route'
import { attachmentAt, type CanvasInk, type InkEntry } from './core/ink'
import { paintInkEntry, type CanvasTheme } from './core/painter'
import type { CanvasViewer } from './Viewer'
import type { InputPorts } from './input'

interface InkGesture {
  id: number
  pen: boolean
  entry: InkEntry
  ahead: number[]
  pressure: number
}
export class CanvasInkInput {
  private gesture: InkGesture | null = null
  constructor(
    private readonly viewer: CanvasViewer,
    private readonly ports: InputPorts
  ) {}
  ignores(event: PointerEvent): boolean {
    return !!this.gesture?.pen && event.pointerType === 'touch'
  }
  down(event: PointerEvent): boolean {
    const tool = this.ports.tool()
    if (tool !== 'pen' && tool !== 'marker') return false
    if (routePointer({ finger: true, penDown: false }, event) !== 'ink') return false
    const rect = this.viewer.stage.getBoundingClientRect(),
      [x, y] = toWorld(this.viewer.camera, event.clientX - rect.left, event.clientY - rect.top)
    const node = attachmentAt(this.viewer.graph, x, y)
    this.ports.select(new Set())
    if (!this.ports.begin()) return true
    const brush = this.ports.brush()
    const stroke: CanvasInk = {
      version: 1,
      id: nanoid(),
      tool,
      color: brush.color,
      size: brush.size,
      points: [],
      ...(node ? { frame: { width: node.width, height: node.height } } : {}),
    }
    this.gesture = {
      id: event.pointerId,
      pen: event.pointerType === 'pen',
      entry: { stroke, node },
      ahead: [],
      pressure: 0.5,
    }
    this.add(event, false)
    this.viewer.drawInk()
    return true
  }
  private sample(event: PointerEvent): number[] {
    const g = this.gesture!,
      node = g.entry.node,
      rect = this.viewer.stage.getBoundingClientRect()
    const [x, y] = toWorld(this.viewer.camera, event.clientX - rect.left, event.clientY - rect.top)
    if (g.pen && event.pressure > 0) g.pressure = event.pressure
    return roundPoint(x - (node?.x ?? 0), y - (node?.y ?? 0), g.pen ? g.pressure : 0.5)
  }
  private add(event: PointerEvent, predicted: boolean): void {
    const g = this.gesture!,
      p = this.sample(event),
      points = predicted ? g.ahead : g.entry.stroke.points,
      n = points.length
    if (n >= 3 && points[n - 3] === p[0] && points[n - 2] === p[1]) return
    points.push(...p)
  }
  move(event: PointerEvent): void {
    const g = this.gesture
    if (!g || g.id !== event.pointerId) return
    if (!this.ports.valid()) {
      this.cancel()
      return
    }
    for (const sample of event.getCoalescedEvents?.() ?? []) this.add(sample, false)
    this.add(event, false)
    g.ahead = []
    const pressure = g.pressure
    for (const sample of event.getPredictedEvents?.() ?? []) this.add(sample, true)
    g.pressure = pressure
    this.viewer.drawInk()
  }
  up(event: PointerEvent): void {
    const g = this.gesture
    if (!g || g.id !== event.pointerId) return
    this.move(event)
    if (this.gesture !== g) return
    this.gesture = null
    this.ports.complete([
      { op: 'add_ink', stroke: g.entry.stroke, ...(g.entry.node ? { node: g.entry.node.id } : {}) },
    ])
    this.viewer.drawInk()
  }
  cancel(): void {
    if (!this.gesture) return
    this.gesture = null
    this.ports.cancel()
    this.viewer.drawInk()
  }
  validate(): void {
    if (this.gesture && !this.ports.valid()) this.cancel()
  }
  paint(ctx: CanvasRenderingContext2D, theme: CanvasTheme): void {
    const g = this.gesture
    if (!g) return
    const node = g.entry.node
    if (node) {
      ctx.save()
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 2 / this.viewer.camera.zoom
      ctx.setLineDash([6 / this.viewer.camera.zoom, 4 / this.viewer.camera.zoom])
      ctx.strokeRect(node.x, node.y, node.width, node.height)
      ctx.restore()
    }
    paintInkEntry(
      ctx,
      { ...g.entry, stroke: { ...g.entry.stroke, points: [...g.entry.stroke.points, ...g.ahead] } },
      theme,
      true
    )
  }
}
