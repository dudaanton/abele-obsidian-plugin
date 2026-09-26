/**
 * The sheet laid over a PDF's pages while drawing is on. Everything that touches the pages lands
 * on it and stops there: the reader's own taps, swipes and selection, and Obsidian's — the swipe
 * from an edge that opens a sidebar, the long press that opens a menu, a pull that opens the
 * command palette — never hear of it. The screen does not scroll under it by itself, and iOS
 * neither shows its magnifier nor turns the pen's writing into text there.
 *
 * What it does with each touch is `inkRoute.ts`'s choice: the pen draws; a finger moves the pages
 * (or draws, when asked to); a finger that comes while the pen is down is the palm, and nothing.
 * The stroke being drawn is shown on a canvas here, at the pen's full rate; on lifting, it goes to
 * its page, which draws it as part of itself (`inkLayer.ts`).
 */
import { strokePath, MARKER_OPACITY, inkLiteral, roundPoint, type InkStroke } from './stroke'
import type { InkRoute } from './inkRoute'
import { swipeDirection } from '../swipe'
import { guardSurface } from './inkGuard'

/** A page under a point: which one, where it is on screen, and its size at 100%. */
export interface InkPageHit {
  index: number
  rect: DOMRect
  width: number
  height: number
}

export interface InkOverlayHost {
  /** The page under a point of the screen, if any. */
  pageAt(x: number, y: number): InkPageHit | null
  route(e: PointerEvent): InkRoute
  /** The stroke the pen draws now, its points left empty; null when the tool is the eraser. */
  brush(): Omit<InkStroke, 'points'> | null
  /** The pen came down or was lifted. */
  pen(down: boolean): void
  commit(index: number, stroke: InkStroke): void
  /** An eraser's touch: its start, each place it passes, in page units, and its end. */
  eraseStart(): void
  eraseAt(index: number, x: number, y: number, radius: number): void
  eraseEnd(): void
  /** Moves the pages by a distance; false when they are turned rather than moved. */
  pan(dx: number, dy: number): boolean
  turn(way: 1 | -1): void
  zoom(way: 'in' | 'out'): void
}

const XHTML = 'http://www.w3.org/1999/xhtml'
/** How far round the eraser reaches, in screen pixels. */
const ERASER_RADIUS = 10

type Gesture =
  | {
      kind: 'ink'
      hit: InkPageHit
      brush: Omit<InkStroke, 'points'>
      points: number[]
      ahead: number[]
    }
  | { kind: 'erase'; x: number; y: number }
  | {
      kind: 'pan'
      x: number
      y: number
      start: { x: number; y: number; t: number }
      moves: { dx: number; dy: number; t: number }[]
      moved: boolean
    }

export class InkOverlay {
  readonly el: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly win: Window
  private readonly gestures = new Map<number, Gesture>()
  private readonly observer: ResizeObserver
  private glide = 0
  private wheelAt = 0
  private readonly off: (() => void)[] = []

  constructor(
    parent: HTMLElement,
    private readonly host: InkOverlayHost,
    dark = false
  ) {
    const doc = parent.ownerDocument
    this.win = doc.defaultView ?? window
    this.el = doc.createElementNS(XHTML, 'div')
    this.el.className = dark ? 'abele-ink-overlay abele-ink-overlay_dark' : 'abele-ink-overlay'
    this.canvas = doc.createElementNS(XHTML, 'canvas') as HTMLCanvasElement
    this.canvas.className = 'abele-ink-overlay__canvas'
    this.el.append(this.canvas)
    parent.append(this.el)
    this.observer = new ResizeObserver(() => this.size())
    this.observer.observe(this.el)
    this.size()

    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      options: AddEventListenerOptions = {}
    ) => {
      this.el.addEventListener(type, fn, options)
      this.off.push(() => this.el.removeEventListener(type, fn, options))
    }
    on('pointerdown', (e) => this.down(e))
    on('pointermove', (e) => this.move(e))
    on('pointerup', (e) => this.up(e, false))
    on('pointercancel', (e) => this.up(e, true))
    // Nothing that lands here goes further: not to the page, not to Obsidian.
    this.off.push(guardSurface(this.el))
    on('wheel', (e) => this.wheel(e), { passive: false })
  }

  destroy(): void {
    this.stopGlide()
    for (const off of this.off) off()
    this.observer.disconnect()
    this.el.remove()
  }

  private size(): void {
    const ratio = this.win.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.round(this.el.clientWidth * ratio))
    this.canvas.height = Math.max(1, Math.round(this.el.clientHeight * ratio))
    this.paint()
  }

  private down(e: PointerEvent): void {
    e.stopPropagation()
    const route = this.host.route(e)
    if (route === 'ignore') return
    this.stopGlide()
    if (e.pointerType === 'pen') {
      this.host.pen(true)
      // A hand that touched first and was taken for a finger drawing: it was the palm.
      for (const [id, g] of this.gestures)
        if (g.kind === 'ink' && id !== e.pointerId && this.isTouch(id)) this.gestures.delete(id)
    }
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      // A pointer the page no longer has: it is not captured, and is followed while it lasts.
    }
    this.touchIds.set(e.pointerId, e.pointerType === 'touch')
    const brush = route === 'ink' ? this.host.brush() : null
    if (route === 'pan') {
      // One finger moves the pages; a second one, as in a pinch, is not a second move.
      if ([...this.gestures.values()].some((g) => g.kind === 'pan')) return
      this.gestures.set(e.pointerId, {
        kind: 'pan',
        x: e.clientX,
        y: e.clientY,
        start: { x: e.clientX, y: e.clientY, t: e.timeStamp },
        moves: [],
        moved: false,
      })
      return
    }
    if (route === 'erase' || !brush) {
      this.host.eraseStart()
      this.gestures.set(e.pointerId, { kind: 'erase', x: e.clientX, y: e.clientY })
      this.erase(e.clientX, e.clientY)
      this.paint()
      return
    }
    const hit = this.host.pageAt(e.clientX, e.clientY)
    if (!hit) return
    const g: Gesture = { kind: 'ink', hit, brush, points: [], ahead: [] }
    this.gestures.set(e.pointerId, g)
    this.addPoint(g, e)
    this.paint()
  }

  private readonly touchIds = new Map<number, boolean>()
  private isTouch(id: number): boolean {
    return !!this.touchIds.get(id)
  }

  private move(e: PointerEvent): void {
    e.stopPropagation()
    const g = this.gestures.get(e.pointerId)
    if (!g) return
    const events = e.getCoalescedEvents?.() ?? []
    const all = events.length ? events : [e]
    if (g.kind === 'ink') {
      for (const one of all) this.addPoint(g, one)
      g.ahead = []
      for (const next of e.getPredictedEvents?.() ?? []) {
        const [x, y, p] = this.toPage(g, next)
        g.ahead.push(x, y, p)
      }
      this.paint()
    } else if (g.kind === 'erase') {
      for (const one of all) this.erase(one.clientX, one.clientY)
      g.x = e.clientX
      g.y = e.clientY
      this.paint()
    } else {
      const dx = e.clientX - g.x
      const dy = e.clientY - g.y
      g.x = e.clientX
      g.y = e.clientY
      if (Math.abs(e.clientX - g.start.x) + Math.abs(e.clientY - g.start.y) > 6) g.moved = true
      g.moves.push({ dx, dy, t: e.timeStamp })
      while (g.moves.length > 1 && e.timeStamp - g.moves[0].t > 100) g.moves.shift()
      this.host.pan(-dx, -dy)
    }
  }

  private up(e: PointerEvent, cancelled: boolean): void {
    e.stopPropagation()
    const g = this.gestures.get(e.pointerId)
    this.gestures.delete(e.pointerId)
    this.touchIds.delete(e.pointerId)
    if (e.pointerType === 'pen') this.host.pen(false)
    if (!g) return
    if (g.kind === 'ink') {
      if (!cancelled || g.points.length > 3) {
        g.ahead = []
        this.host.commit(g.hit.index, { ...g.brush, points: g.points })
      }
    } else if (g.kind === 'erase') this.host.eraseEnd()
    else if (!cancelled) this.release(g, e)
    this.paint()
  }

  /** A finger let go of the pages: they glide on, slowing, or — pages that turn — turn. */
  private release(g: Extract<Gesture, { kind: 'pan' }>, e: PointerEvent): void {
    const way = swipeDirection(g.start, { x: e.clientX, y: e.clientY, t: e.timeStamp })
    if (!this.host.pan(0, 0)) {
      if (way === 'left') this.host.turn(1)
      else if (way === 'right') this.host.turn(-1)
      return
    }
    const span = g.moves.length ? e.timeStamp - g.moves[0].t : 0
    if (span <= 0 || e.timeStamp - (g.moves[g.moves.length - 1]?.t ?? 0) > 80) return
    let vx = g.moves.reduce((s, m) => s + m.dx, 0) / span
    let vy = g.moves.reduce((s, m) => s + m.dy, 0) / span
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(40, now - last)
      last = now
      const decay = Math.pow(0.995, dt)
      vx *= decay
      vy *= decay
      if (Math.hypot(vx, vy) < 0.02) {
        this.glide = 0
        return
      }
      this.host.pan(-vx * dt, -vy * dt)
      this.glide = this.win.requestAnimationFrame(step)
    }
    this.glide = this.win.requestAnimationFrame(step)
  }

  private stopGlide(): void {
    if (this.glide) this.win.cancelAnimationFrame(this.glide)
    this.glide = 0
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey) {
      if (e.timeStamp - this.wheelAt < 120 || !e.deltaY) return
      this.wheelAt = e.timeStamp
      this.host.zoom(e.deltaY < 0 ? 'in' : 'out')
      return
    }
    if (this.host.pan(e.deltaX, e.deltaY)) return
    if (e.timeStamp - this.wheelAt < 400 || Math.abs(e.deltaY) < 20) return
    this.wheelAt = e.timeStamp
    this.host.turn(e.deltaY > 0 ? 1 : -1)
  }

  private toPage(g: Extract<Gesture, { kind: 'ink' }>, e: PointerEvent): [number, number, number] {
    const { rect, width, height } = g.hit
    const x = ((e.clientX - rect.left) / rect.width) * width
    const y = ((e.clientY - rect.top) / rect.height) * height
    // A pen reports its pressure; a mouse and a finger report none worth reading.
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5
    return roundPoint(x, y, p)
  }

  private addPoint(g: Extract<Gesture, { kind: 'ink' }>, e: PointerEvent): void {
    const [x, y, p] = this.toPage(g, e)
    const n = g.points.length
    if (n >= 3 && g.points[n - 3] === x && g.points[n - 2] === y) return
    g.points.push(x, y, p)
  }

  private erase(cx: number, cy: number): void {
    const hit = this.host.pageAt(cx, cy)
    if (!hit) return
    const k = hit.width / hit.rect.width
    this.host.eraseAt(
      hit.index,
      (cx - hit.rect.left) * k,
      (cy - hit.rect.top) * k,
      ERASER_RADIUS * k
    )
  }

  /** The strokes being drawn, and the eraser's ring, on the canvas over the pages. */
  private paint(): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const ratio = this.win.devicePixelRatio || 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!this.gestures.size) return
    const base = this.el.getBoundingClientRect()
    for (const g of this.gestures.values()) {
      if (g.kind === 'erase') {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
        ctx.beginPath()
        ctx.arc(g.x - base.left, g.y - base.top, ERASER_RADIUS, 0, Math.PI * 2)
        ctx.lineWidth = 1
        ctx.strokeStyle = '#888888'
        ctx.stroke()
        continue
      }
      if (g.kind !== 'ink') continue
      const { rect, width } = g.hit
      const k = rect.width / width
      ctx.setTransform(
        ratio * k,
        0,
        0,
        ratio * k,
        ratio * (rect.left - base.left),
        ratio * (rect.top - base.top)
      )
      const stroke: InkStroke = { ...g.brush, points: [...g.points, ...g.ahead] }
      const path = new Path2D(strokePath(stroke))
      const color = inkLiteral(stroke.color)
      if (stroke.tool === 'marker') {
        ctx.globalAlpha = MARKER_OPACITY
        ctx.globalCompositeOperation = 'multiply'
        ctx.strokeStyle = color
        ctx.lineWidth = stroke.size
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke(path)
      } else {
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = color
        ctx.fill(path)
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}
