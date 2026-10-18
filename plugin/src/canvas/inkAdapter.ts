/** Pointer sampling only; one completed stroke uses the editor's existing draft/history. */
import { nanoid } from 'nanoid'
import { toWorld } from '../drawing/camera'
import { liveFreedraw } from '../ink/freedraw'
import { routePointer } from '../ink/route'
import { attachmentAt, type CanvasInk, type InkEntry } from './core/ink'
import { paintInkEntry, type CanvasTheme } from './core/painter'
import type { CanvasViewer } from './Viewer'
import type { InputPorts } from './input'
import { recognizeStroke, type Recognized } from './core/recognize'
import type { CanvasOperation } from './core/edit'

interface InkGesture {
  id: number
  pen: boolean
  entry: InkEntry
  pressure: number
  /** Drawn while the last change was still being written: kept to be added after it. */
  held: boolean
  /** Held still at its end, the plain shape the stroke becomes, shown in its place. */
  snap: Recognized | null
  /** Waits for the pen to be held still. */
  timer: number
  /** Where the pointer last was, on the screen, to tell a held pen from a moving one. */
  at: [number, number]
}
/** How long a pen held still at a stroke's end waits before the stroke becomes a shape. */
export const HOLD_MS = 500
export class CanvasInkInput {
  private gesture: InkGesture | null = null
  /** Strokes finished while the last change was being written, shown until they are added. */
  private kept: InkEntry[] = []
  constructor(
    private readonly viewer: CanvasViewer,
    private readonly ports: InputPorts
  ) {}
  ignores(event: PointerEvent): boolean {
    return !!this.gesture?.pen && event.pointerType === 'touch'
  }
  /**
   * `as` draws with a pen or marker other than the tool in hand: the Pencil's own. `held` draws
   * while the last change is still being written, so the stroke waits to be added after it.
   */
  down(event: PointerEvent, as?: 'pen' | 'marker', held = false): boolean {
    const tool = as ?? this.ports.tool()
    if (tool !== 'pen' && tool !== 'marker') return false
    if (routePointer({ finger: true, penDown: false }, event) !== 'ink') return false
    const rect = this.viewer.stage.getBoundingClientRect(),
      [x, y] = toWorld(this.viewer.camera, event.clientX - rect.left, event.clientY - rect.top)
    const node = attachmentAt(this.viewer.graph, x, y)
    if (!held) this.ports.select(new Set())
    if (!held && !this.ports.begin()) return true
    const brush = this.ports.brush(tool)
    const stroke: CanvasInk = {
      version: 1,
      id: nanoid(),
      tool,
      color: brush.color,
      size: brush.size,
      points: [],
      linear: true,
      freedraw: liveFreedraw(),
      ...(node ? { frame: { width: node.width, height: node.height } } : {}),
    }
    this.gesture = {
      id: event.pointerId,
      pen: event.pointerType === 'pen',
      entry: { stroke, node },
      pressure: 0.5,
      held,
      snap: null,
      timer: 0,
      at: [event.clientX, event.clientY],
    }
    this.hold()
    this.add(event)
    this.viewer.drawInk()
    return true
  }
  private sample(event: PointerEvent): number[] {
    const g = this.gesture,
      node = g.entry.node,
      rect = this.viewer.stage.getBoundingClientRect()
    const [x, y] = toWorld(this.viewer.camera, event.clientX - rect.left, event.clientY - rect.top)
    if (g.pen) g.pressure = Math.min(1, Math.max(0, event.pressure))
    return [x - (node?.x ?? 0), y - (node?.y ?? 0), g.pen ? g.pressure : 0.5]
  }
  private add(event: PointerEvent): void {
    const g = this.gesture,
      p = this.sample(event),
      points = g.entry.stroke.points,
      n = points.length
    if (n >= 3 && points[n - 3] === p[0] && points[n - 2] === p[1]) return
    points.push(...p)
  }
  move(event: PointerEvent): void {
    const g = this.gesture
    if (!g || g.id !== event.pointerId) return
    if (!g.held && !this.ports.valid()) {
      this.cancel()
      return
    }
    // Every sample the pointer went through, and only those: points the browser predicts ahead
    // of the pen are drawn and then taken back each frame, which reads as the line jumping.
    for (const sample of event.getCoalescedEvents?.() ?? []) this.add(sample)
    this.add(event)
    // Moving on after a shape showed takes the stroke back to how it was drawn.
    if (Math.hypot(event.clientX - g.at[0], event.clientY - g.at[1]) > 3) {
      g.at = [event.clientX, event.clientY]
      g.snap = null
      this.hold()
    }
    this.viewer.drawInk()
  }
  /** Waits for the pen to stay still, then shows the shape the stroke would become. */
  private hold(): void {
    const g = this.gesture
    if (!g) return
    const win = this.viewer.el.ownerDocument.defaultView
    win.clearTimeout(g.timer)
    g.timer = win.setTimeout(() => {
      if (this.gesture !== g) return
      g.snap = recognizeStroke(g.entry.stroke.points)
      if (g.snap) this.viewer.drawInk()
    }, HOLD_MS)
  }
  /** The edits that put the recognized shape where the stroke was, in the stroke's colour. */
  private shapeOps(g: InkGesture): CanvasOperation[] {
    const snap = g.snap,
      ox = g.entry.node?.x ?? 0,
      oy = g.entry.node?.y ?? 0,
      color = g.entry.stroke.color
    if (snap.kind === 'line') {
      const r = (v: number) => Math.round(v)
      return [
        {
          op: 'add_line',
          line: {
            version: 1,
            id: nanoid(),
            from: { x: r(snap.from.x + ox), y: r(snap.from.y + oy) },
            to: { x: r(snap.to.x + ox), y: r(snap.to.y + oy) },
            toEnd: 'none',
            ...(color ? { color } : {}),
          },
        },
      ]
    }
    return [
      {
        op: 'add_node',
        node: {
          id: nanoid(),
          kind: 'shape',
          shape: snap.kind === 'circle' ? 'circle' : 'rectangle',
          label: '',
          x: Math.round(snap.rect.x + ox),
          y: Math.round(snap.rect.y + oy),
          width: Math.max(20, Math.round(snap.rect.width)),
          height: Math.max(20, Math.round(snap.rect.height)),
          ...(/^[1-6]$/.test(color) ? { color } : {}),
        },
      },
    ]
  }
  up(event: PointerEvent): void {
    const g = this.gesture
    if (!g || g.id !== event.pointerId) return
    this.move(event)
    if (this.gesture !== g) return
    this.gesture = null
    this.viewer.el.ownerDocument.defaultView.clearTimeout(g.timer)
    const ops = g.snap
      ? this.shapeOps(g)
      : [
          {
            op: 'add_ink' as const,
            stroke: g.entry.stroke,
            ...(g.entry.node ? { node: g.entry.node.id } : {}),
          },
        ]
    if (g.held && ops.length === 1 && ops[0].op === 'add_ink') {
      this.kept.push(g.entry)
      this.ports.hold?.(ops[0])
    } else if (g.held) this.ports.invalid(new Error('A shape drawn while saving was not kept'))
    else this.ports.complete(ops)
    this.viewer.drawInk()
  }
  /** A kept stroke has been added to the canvas, or given up: it is no longer drawn here. */
  release(id: string): void {
    this.kept = this.kept.filter((e) => e.stroke.id !== id)
    this.viewer.drawInk()
  }
  cancel(): void {
    if (!this.gesture) return
    const g = this.gesture
    this.viewer.el.ownerDocument.defaultView.clearTimeout(g.timer)
    this.gesture = null
    if (!g.held) this.ports.cancel()
    this.viewer.drawInk()
  }
  validate(): void {
    if (this.gesture && !this.gesture.held && !this.ports.valid()) this.cancel()
  }
  paint(ctx: CanvasRenderingContext2D, theme: CanvasTheme): void {
    for (const entry of this.kept) paintInkEntry(ctx, entry, theme, true)
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
    if (g.snap) {
      // The shape it will become, drawn where the stroke is, in the stroke's own width.
      const ox = node?.x ?? 0,
        oy = node?.y ?? 0,
        snap = g.snap
      ctx.save()
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = Math.max(1.5, g.entry.stroke.size)
      ctx.beginPath()
      if (snap.kind === 'line') {
        ctx.moveTo(snap.from.x + ox, snap.from.y + oy)
        ctx.lineTo(snap.to.x + ox, snap.to.y + oy)
      } else if (snap.kind === 'circle')
        ctx.ellipse(
          snap.rect.x + ox + snap.rect.width / 2,
          snap.rect.y + oy + snap.rect.height / 2,
          snap.rect.width / 2,
          snap.rect.height / 2,
          0,
          0,
          Math.PI * 2
        )
      else ctx.rect(snap.rect.x + ox, snap.rect.y + oy, snap.rect.width, snap.rect.height)
      ctx.stroke()
      ctx.restore()
      return
    }
    paintInkEntry(
      ctx,
      { ...g.entry, stroke: { ...g.entry.stroke, points: [...g.entry.stroke.points] } },
      theme,
      true
    )
  }
}
