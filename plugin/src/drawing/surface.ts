/**
 * The surface a drawing is shown and drawn on: every touch, click and wheel that lands on it.
 *
 * Nothing that lands here goes further — not to Obsidian's swipes, menus and long presses, not to
 * the browser's scrolling and magnifier (`inkGuard.ts`, shared with the PDF ink). What each touch
 * does is decided here:
 *
 * - while drawing, `inkRoute.ts` decides, as it does on a PDF: the pen draws, the eraser end of
 *   a pen erases, the mouse draws with its main button, a finger moves the drawing unless drawing
 *   with a finger is on, and a finger that comes while the pen is down is the palm, and nothing;
 * - otherwise everything moves the drawing;
 * - two fingers pinch, Ctrl or ⌘ with the wheel (and a trackpad's pinch) zoom at the pointer,
 *   the wheel alone scrolls, the middle mouse button drags.
 *
 * What a drawing touch does is the tool's (`ToolGesture`): the surface gives it the points, in
 * the drawing's units, at the pen's full rate, and paints its live part on a layer of its own.
 */
import { guardSurface } from '@/reader/ink/inkGuard'
import type { InkRoute } from '@/reader/ink/inkRoute'
import { panBy, toWorld, zoomAt, type Camera } from './camera'
import { DrawingRenderer } from './renderer'
import { PAPER } from './drawingFile'

export interface WorldPoint {
  x: number
  y: number
  /** The pen's pressure, 0–1; half for a mouse and a finger, which report none worth reading. */
  p: number
}

/** What one touch of a drawing tool does as it goes. */
export interface ToolGesture {
  move(points: WorldPoint[], ahead: WorldPoint[]): void
  end(cancelled: boolean): void
  /** Its part on the live layer, the context set to the drawing's units. */
  paint?(ctx: CanvasRenderingContext2D, zoom: number): void
}

export interface SurfaceHost {
  /** Drawing is on: the tools answer, not only the camera. */
  drawing(): boolean
  route(e: PointerEvent): InkRoute
  /** The pen came down or was lifted. */
  pen(down: boolean): void
  /** A touch of the tool in hand (`ink`) or of the eraser (`erase`) begins. */
  begin(route: 'ink' | 'erase', at: WorldPoint, e: PointerEvent): ToolGesture | null
  camera(): Camera
  setCamera(camera: Camera): void
  /** What else the live layer shows — what is picked, and its box — the context as for a tool. */
  overlay?(ctx: CanvasRenderingContext2D, zoom: number): void
  /** A touch landed: whatever was being typed is kept first. */
  touched?(): void
  /** A touch that moved the drawing hardly moved at all: a tap, at a point of the drawing. */
  tap?(x: number, y: number): void
  /** Something dragged in from elsewhere — a note from the file list — let go at a point. */
  drop?(text: string, x: number, y: number): void
}

const XHTML = 'http://www.w3.org/1999/xhtml'

type Touch =
  | { kind: 'tool'; gesture: ToolGesture; touch: boolean }
  | { kind: 'pan'; x: number; y: number; x0: number; y0: number; moved: boolean }

export class DrawingSurface {
  readonly el: HTMLElement
  readonly renderer: DrawingRenderer
  private readonly live: HTMLCanvasElement
  private readonly win: Window
  private readonly touches = new Map<number, Touch>()
  private readonly observer: ResizeObserver
  private readonly off: (() => void)[] = []
  private frame = 0
  /** Called when the surface changes size. */
  onResize: (() => void) | null = null

  constructor(
    parent: HTMLElement,
    private readonly host: SurfaceHost
  ) {
    const doc = parent.ownerDocument
    this.win = doc.defaultView ?? window
    this.el = doc.createElementNS(XHTML, 'div')
    this.el.className = 'abele-drawing-surface'
    // The paper, under the notes shown on the drawing and under the ink.
    this.el.setCssStyles({ backgroundColor: PAPER })
    const main = doc.createElementNS(XHTML, 'canvas') as HTMLCanvasElement
    main.className = 'abele-drawing-surface__canvas'
    this.live = doc.createElementNS(XHTML, 'canvas') as HTMLCanvasElement
    this.live.className = 'abele-drawing-surface__canvas abele-drawing-surface__canvas_live'
    this.el.append(main, this.live)
    parent.append(this.el)
    this.renderer = new DrawingRenderer(main, () => this.win.devicePixelRatio || 1)
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
    on('wheel', (e) => this.wheel(e), { passive: false })
    // A note dragged in from the file list lands where it is let go.
    on('dragover', (e) => {
      if (!this.host.drop) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'link'
    })
    on('drop', (e) => {
      const text = e.dataTransfer?.getData('text/plain') ?? ''
      if (!this.host.drop || !text) return
      e.preventDefault()
      e.stopPropagation()
      const [x, y] = this.worldAt(e)
      this.host.drop(text, x, y)
    })
    this.off.push(guardSurface(this.el))
  }

  destroy(): void {
    if (this.frame) this.win.cancelAnimationFrame(this.frame)
    for (const off of this.off) off()
    this.observer.disconnect()
    this.el.remove()
  }

  /** The view's size in CSS pixels. */
  get width(): number {
    return this.el.clientWidth
  }

  get height(): number {
    return this.el.clientHeight
  }

  private size(): void {
    const w = this.el.clientWidth
    const h = this.el.clientHeight
    const r = this.win.devicePixelRatio || 1
    this.renderer.resize(w, h)
    this.live.width = Math.max(1, Math.round(w * r))
    this.live.height = Math.max(1, Math.round(h * r))
    this.onResize?.()
  }

  /** Paints the live layer on the next frame. */
  paintLive(): void {
    if (this.frame) return
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0
      this.paintLiveNow()
    })
  }

  private paintLiveNow(): void {
    const ctx = this.live.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.live.width, this.live.height)
    const c = this.host.camera()
    const r = this.win.devicePixelRatio || 1
    ctx.setTransform(r * c.zoom, 0, 0, r * c.zoom, -c.x * r * c.zoom, -c.y * r * c.zoom)
    this.host.overlay?.(ctx, c.zoom)
    for (const t of this.touches.values()) if (t.kind === 'tool') t.gesture.paint?.(ctx, c.zoom)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  /** A point of the screen, in the drawing's units. */
  worldAt(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.el.getBoundingClientRect()
    return toWorld(this.host.camera(), e.clientX - rect.left, e.clientY - rect.top)
  }

  private point(e: PointerEvent): WorldPoint {
    const [x, y] = this.worldAt(e)
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5
    return { x, y, p }
  }

  private routeOf(e: PointerEvent): InkRoute {
    // The middle button drags whatever is in hand.
    if (e.pointerType === 'mouse' && e.buttons & 4) return 'pan'
    if (!this.host.drawing())
      return e.pointerType === 'mouse' && !(e.buttons & 1) ? 'ignore' : 'pan'
    return this.host.route(e)
  }

  private down(e: PointerEvent): void {
    e.stopPropagation()
    this.host.touched?.()
    const route = this.routeOf(e)
    if (route === 'ignore') return
    if (e.pointerType === 'pen' && this.host.drawing()) {
      this.host.pen(true)
      // A hand that touched first and was taken for a finger drawing: it was the palm.
      for (const [id, t] of this.touches)
        if (t.kind === 'tool' && t.touch) {
          t.gesture.end(true)
          this.touches.delete(id)
        }
    }
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      // A pointer the page no longer has: it is not captured, and is followed while it lasts.
    }
    if (route === 'pan') {
      this.touches.set(e.pointerId, {
        kind: 'pan',
        x: e.clientX,
        y: e.clientY,
        x0: e.clientX,
        y0: e.clientY,
        moved: false,
      })
      return
    }
    const gesture = this.host.begin(route, this.point(e), e)
    if (!gesture) return
    this.touches.set(e.pointerId, { kind: 'tool', gesture, touch: e.pointerType === 'touch' })
    this.paintLive()
  }

  private move(e: PointerEvent): void {
    e.stopPropagation()
    const t = this.touches.get(e.pointerId)
    if (!t) return
    if (t.kind === 'tool') {
      const events = e.getCoalescedEvents?.() ?? []
      const all = (events.length ? events : [e]).map((one) => this.point(one))
      const ahead = (e.getPredictedEvents?.() ?? []).map((one) => this.point(one))
      t.gesture.move(all, ahead)
      this.paintLive()
      return
    }
    const pans = [...this.touches.entries()].filter(([, v]) => v.kind === 'pan') as [
      number,
      Extract<Touch, { kind: 'pan' }>,
    ][]
    const rect = this.el.getBoundingClientRect()
    if (pans.length >= 2) {
      // Two fingers: the drawing stays under both, zooming as they part or close.
      const other = pans.find(([id]) => id !== e.pointerId)?.[1]
      if (!other) return
      const before = Math.hypot(t.x - other.x, t.y - other.y)
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      const cx0 = (t.x + other.x) / 2 - rect.left
      const cy0 = (t.y + other.y) / 2 - rect.top
      const cx1 = (e.clientX + other.x) / 2 - rect.left
      const cy1 = (e.clientY + other.y) / 2 - rect.top
      let c = this.host.camera()
      if (before > 4 && after > 4) c = zoomAt(c, cx0, cy0, after / before)
      c = panBy(c, cx1 - cx0, cy1 - cy0)
      this.host.setCamera(c)
    } else {
      this.host.setCamera(panBy(this.host.camera(), e.clientX - t.x, e.clientY - t.y))
    }
    t.x = e.clientX
    t.y = e.clientY
    if (Math.hypot(t.x - t.x0, t.y - t.y0) > 6 || pans.length > 1) t.moved = true
  }

  private up(e: PointerEvent, cancelled: boolean): void {
    e.stopPropagation()
    const t = this.touches.get(e.pointerId)
    this.touches.delete(e.pointerId)
    if (e.pointerType === 'pen' && this.host.drawing()) this.host.pen(false)
    if (t?.kind === 'tool') t.gesture.end(cancelled)
    else if (t?.kind === 'pan' && !t.moved && !cancelled && !this.touches.size) {
      const [x, y] = this.worldAt(e)
      this.host.tap?.(x, y)
    }
    this.paintLive()
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault()
    e.stopPropagation()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1
    const dx = e.deltaX * unit
    const dy = e.deltaY * unit
    const rect = this.el.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      // A trackpad's pinch comes as the wheel with Ctrl held, in small steps; a mouse's wheel in
      // large ones, which are held to a step of a reasonable size.
      const step = Math.max(-50, Math.min(50, dy))
      this.host.setCamera(
        zoomAt(
          this.host.camera(),
          e.clientX - rect.left,
          e.clientY - rect.top,
          Math.exp(-step * 0.01)
        )
      )
      return
    }
    this.host.setCamera(
      panBy(this.host.camera(), e.shiftKey && !dx ? -dy : -dx, e.shiftKey && !dx ? 0 : -dy)
    )
  }

  /** Every touch let go of, as when drawing is turned off in the middle of one. */
  cancelAll(): void {
    for (const t of this.touches.values()) if (t.kind === 'tool') t.gesture.end(true)
    this.touches.clear()
    this.paintLive()
  }
}
