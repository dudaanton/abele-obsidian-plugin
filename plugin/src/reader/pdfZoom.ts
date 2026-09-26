/**
 * Zooming a PDF: buttons and keys a step at a time, a fit to the width or the whole page, and a
 * pinch — two fingers on a touch screen, a trackpad's pinch or Ctrl with the wheel on a computer —
 * which follows the fingers smoothly and keeps the place under them where it is.
 *
 * During a pinch the pages are only stretched as a picture (a CSS transform on the renderer, which
 * costs nothing); when the fingers lift the zoom is set once, the pages near the screen are drawn
 * again at the new size (`pdfBook.drawPage`), and the scroll is put so the place that was under the
 * fingers is under them still. Ink and highlights are part of each page's own frame, so they follow.
 *
 * The zoom a book was left at is kept for it on this device — screens differ from one device to
 * another, so it is not synced with the book's place.
 */
import { AbeleConfig } from '@/services/AbeleConfig'
import { pdfZoomFor, readerSettingsFrom } from './settings'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4
/**
 * The most pixels one page is drawn with: 8 million is a page four times over on a tablet's
 * screen, and well inside what WebKit lets a page hold before it stops drawing canvases.
 */
export const MAX_PAGE_PIXELS = 8_000_000
/** How long after the last wheel event of a burst the zoom is set. */
const WHEEL_SETTLE = 200

export interface Point {
  x: number
  y: number
}

export const clampZoom = (scale: number): number =>
  Number.isFinite(scale) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale)) : 1

/** How much one wheel event zooms: a trackpad's pinch sends many small ones, a mouse a few big. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  if (!pixels) return 1
  return Math.exp(Math.min(0.2, Math.max(-0.2, -pixels * 0.01)))
}

/**
 * How many pixels a page is drawn with for each of its pixels on screen: the screen's own ratio,
 * less when a page that large would take more than `MAX_PAGE_PIXELS` — then it is a little soft
 * rather than not drawn at all — but never less than one.
 */
export function renderRatio(zoom: number, dpr: number, width: number, height: number): number {
  const shown = width * zoom * height * zoom
  if (shown <= 0) return dpr
  const fits = Math.sqrt(MAX_PAGE_PIXELS / shown)
  return Math.max(1, Math.min(dpr, fits))
}

/**
 * Two fingers moved from `from` to `to`, on pages drawn at `base`: the picture's stretch
 * (`translate(x, y) scale(scale)` from the top left), the point of the pages they started over
 * (`from`, in the renderer's box before the pinch) and where it is to stay (`to`).
 */
export function pinchView(
  base: number,
  from: [Point, Point],
  to: [Point, Point]
): { scale: number; x: number; y: number; from: Point; to: Point } {
  const d0 = Math.hypot(from[0].x - from[1].x, from[0].y - from[1].y)
  const d1 = Math.hypot(to[0].x - to[1].x, to[0].y - to[1].y)
  const scale = clampZoom(base * (d0 > 0 ? d1 / d0 : 1)) / base
  const a = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 }
  const b = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 }
  return { scale, x: b.x - a.x * scale, y: b.y - a.y * scale, from: a, to: b }
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The scroll that puts a point of a page — `point`, in the scroll's content, when the page was
 * laid out as `before` — at `to` on the screen, now that the page is laid out as `after`.
 */
export function keepPoint(before: Box, point: Point, after: Box, to: Point): Point {
  const fx = before.width ? (point.x - before.left) / before.width : 0
  const fy = before.height ? (point.y - before.top) / before.height : 0
  return { x: after.left + fx * after.width - to.x, y: after.top + fy * after.height - to.y }
}

export interface TouchPoint {
  id: number
  x: number
  y: number
  /** Whether the frame that heard it is still there: a page dropped from the scroll under a
   * finger never hears the finger lift. */
  alive?: () => boolean
}

/**
 * Tells two fingers from one, across every document the pages are in: a finger on one page and a
 * finger on the next are heard by two frames, and only together are they a pinch. Points are in
 * one space, the app window's, whichever frame heard them.
 */
export class PinchTracker {
  private readonly points = new Map<number, Point & { alive?: () => boolean }>()
  private pair: [number, number] | null = null
  private start: [Point, Point] | null = null

  constructor(
    private readonly on: {
      begin(): void
      move(from: [Point, Point], to: [Point, Point]): void
      end(from: [Point, Point], to: [Point, Point]): void
    }
  ) {}

  get pinching(): boolean {
    return !!this.pair
  }

  /** A touch event's changed touches; true while they are a pinch, and are not to scroll. */
  touch(type: 'start' | 'move' | 'end' | 'cancel', changed: TouchPoint[]): boolean {
    for (const t of changed) this.points.set(t.id, { x: t.x, y: t.y, alive: t.alive })
    if (type === 'start' && !this.pair)
      for (const [id, p] of this.points) if (p.alive && !p.alive()) this.points.delete(id)
    if (type === 'start' && !this.pair && this.points.size >= 2) {
      const [a, b] = [...this.points.keys()].slice(-2)
      this.pair = [a, b]
      this.start = [this.at(a), this.at(b)]
      this.on.begin()
      return true
    }
    const pair = this.pair
    const start = this.start
    if (type === 'end' || type === 'cancel') {
      const lifted = pair && start && changed.some((t) => pair.includes(t.id))
      if (lifted) this.on.end(start, [this.at(pair[0]), this.at(pair[1])])
      for (const t of changed) this.points.delete(t.id)
      if (lifted) {
        this.pair = null
        this.start = null
        // A finger left on the glass is not the start of another pinch or a scroll of ours.
        this.points.clear()
      }
      return !!lifted
    }
    if (pair && start && type === 'move') {
      this.on.move(start, [this.at(pair[0]), this.at(pair[1])])
      return true
    }
    return !!pair
  }

  private at(id: number): Point {
    return this.points.get(id) ?? { x: 0, y: 0 }
  }
}

/** Where each book's zoom is kept: one small map in the device's storage, the newest last. */
export class ZoomMemory {
  constructor(
    private readonly load: () => string | null,
    private readonly save: (value: string | null) => void,
    private readonly keep = 200
  ) {}

  get(key: string): string | null {
    const value = this.read()[key]
    return typeof value === 'string' && isZoom(value) ? value : null
  }

  set(key: string, value: string | null): void {
    const all = this.read()
    delete all[key]
    if (value !== null) all[key] = value
    const keys = Object.keys(all)
    for (const old of keys.slice(0, Math.max(0, keys.length - this.keep))) delete all[old]
    this.save(JSON.stringify(all))
  }

  private read(): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(this.load() ?? '{}')
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
}

/**
 * A page turned one at a time that is zoomed past the screen — past its width, when `sideways` —
 * and is moved about rather than turned.
 */
export function zoomedPast(renderer: Element, sideways = false): boolean {
  const wide = renderer.scrollWidth > renderer.clientWidth + 1
  return sideways ? wide : wide || renderer.scrollHeight > renderer.clientHeight + 1
}

/** A zoom as the renderer takes it: a fit, or a number within the limits. */
export function isZoom(value: string): boolean {
  if (value === 'fit-width' || value === 'fit-page') return true
  const n = Number(value)
  return Number.isFinite(n) && n >= MIN_ZOOM && n <= MAX_ZOOM
}

/** A renderer that sets its own zoom keeping a point in place: the continuous scroll. */
interface AnchoredRenderer extends HTMLElement {
  scale?: number
  zoomAt?(zoom: string, from?: Point, to?: Point): void
  panBy?(dx: number, dy: number): void
}

export interface PdfZoomHost {
  /** The engine's element: its box is where the renderer sits, and the pinch is measured in. */
  engine(): HTMLElement | null
  renderer(): AnchoredRenderer | null
  /** The zoom the settings ask for, when none has been chosen for this book. */
  setting(): string
  /** A zoom was set: the scale the page being read is drawn at now. */
  changed(scale: number): void
}

/** One open PDF's zoom. */
export class PdfZoom {
  /** The zoom chosen for this book; null follows the settings. */
  value: string | null
  private base = 1
  private view: { scale: number; x: number; y: number; from: Point; to: Point } | null = null
  private wheelTimer = 0
  private readonly tracker = new PinchTracker({
    begin: () => this.pinchStart(),
    move: (from, to) => this.pinchMove(from, to),
    end: (from, to) => this.pinchEnd(from, to),
  })

  constructor(
    private readonly host: PdfZoomHost,
    private readonly memory: ZoomMemory,
    private readonly key: string
  ) {
    this.value = memory.get(key)
  }

  /** The zoom the renderer is to have. */
  get zoom(): string {
    return this.value ?? this.host.setting()
  }

  /** The scale the page being read is drawn at. */
  get scale(): number {
    const r = this.host.renderer()
    return r?.scale ?? (Number(r?.getAttribute('zoom')) || 1)
  }

  /** A step in or out, a fit, or back to the setting. */
  set(way: 'in' | 'out' | 'reset' | 'fit-width' | 'fit-page', stepOf: (s: number) => number): void {
    this.settle()
    if (way === 'reset') this.apply(null)
    else if (way === 'fit-width' || way === 'fit-page') this.apply(way)
    else {
      // A step keeps the middle of the screen where it is.
      const box = this.host.engine()?.getBoundingClientRect()
      const mid = box ? { x: box.width / 2, y: box.height / 2 } : undefined
      this.apply(String(clampZoom(stepOf(this.scale))), mid, mid)
    }
  }

  /** Sets a zoom on the renderer, keeping the point `from` (renderer box) at `to`. */
  private apply(value: string | null, from?: Point, to?: Point): void {
    this.value = value
    this.memory.set(this.key, value)
    const r = this.host.renderer()
    if (!r) return
    const zoom = this.zoom
    if (r.zoomAt) r.zoomAt(zoom, from, to)
    else {
      // Pages turned one at a time: the renderer lays itself out, and its own scroll is moved.
      const before = this.scale
      r.setAttribute('zoom', zoom)
      const k = this.scale / (before || 1)
      if (from && to) {
        r.scrollLeft = (r.scrollLeft + from.x) * k - to.x
        r.scrollTop = (r.scrollTop + from.y) * k - to.y
      }
    }
    this.host.changed(this.scale)
  }

  // ————— The picture stretched while the fingers move —————

  private origin(): Point {
    const box = this.host.engine()?.getBoundingClientRect()
    return { x: box?.left ?? 0, y: box?.top ?? 0 }
  }

  private show(v: { scale: number; x: number; y: number } | null): void {
    const r = this.host.renderer()
    if (!r) return
    r.setCssProps(
      v
        ? {
            'transform-origin': '0 0',
            'will-change': 'transform',
            transform: `translate(${v.x}px, ${v.y}px) scale(${v.scale})`,
          }
        : { 'transform-origin': '', 'will-change': '', transform: '' }
    )
  }

  /** Two fingers came down (window coordinates from here on). */
  pinchStart(): void {
    this.settle()
    this.base = this.scale
    this.view = null
  }

  pinchMove(from: [Point, Point], to: [Point, Point]): void {
    const o = this.origin()
    const local = (p: Point) => ({ x: p.x - o.x, y: p.y - o.y })
    this.view = pinchView(this.base, [local(from[0]), local(from[1])], [local(to[0]), local(to[1])])
    this.show(this.view)
  }

  pinchEnd(from: [Point, Point], to: [Point, Point]): void {
    this.pinchMove(from, to)
    this.commit()
  }

  /** The stretch made real: the zoom set, the pages drawn again, the point kept. */
  private commit(): void {
    const v = this.view
    this.view = null
    this.show(null)
    if (!v) return
    if (Math.abs(v.scale - 1) < 0.01) {
      // Two fingers that only moved: the pages move with them.
      const r = this.host.renderer()
      const dx = v.from.x - v.to.x
      const dy = v.from.y - v.to.y
      if (r?.panBy) r.panBy(dx, dy)
      else r?.scrollBy({ left: dx, top: dy, behavior: 'instant' })
      return
    }
    this.apply(String(Math.round(clampZoom(this.base * v.scale) * 1000) / 1000), v.from, v.to)
  }

  /** A gesture half done — a wheel burst — is finished before anything else zooms. */
  private settle(): void {
    if (!this.wheelTimer) return
    window.clearTimeout(this.wheelTimer)
    this.wheelTimer = 0
    this.commit()
  }

  /** Ctrl with the wheel, or a trackpad's pinch, at a point of the window. */
  wheel(e: WheelEvent, at: Point): void {
    e.preventDefault()
    if (!e.deltaY) return
    const o = this.origin()
    const p = { x: at.x - o.x, y: at.y - o.y }
    if (!this.wheelTimer) {
      this.base = this.scale
      this.view = { scale: 1, x: 0, y: 0, from: p, to: p }
    }
    const v = this.view ?? { scale: 1, x: 0, y: 0, from: p, to: p }
    const scale = clampZoom(this.base * v.scale * wheelFactor(e.deltaY, e.deltaMode)) / this.base
    // The point under the pointer when the burst began stays under it.
    this.view = {
      scale,
      x: v.to.x - v.from.x * scale,
      y: v.to.y - v.from.y * scale,
      from: v.from,
      to: v.to,
    }
    this.show(this.view)
    window.clearTimeout(this.wheelTimer)
    this.wheelTimer = window.setTimeout(() => {
      this.wheelTimer = 0
      this.commit()
    }, WHEEL_SETTLE)
  }

  // ————— Listening —————

  /**
   * A document the pages are in — a page's frame, or the app's own for the gaps between pages:
   * its touches and its Ctrl-wheel, in the app window's coordinates.
   */
  watch(doc: Document, target: EventTarget = doc): void {
    const toWindow = (x: number, y: number): Point => {
      const frame = doc.defaultView?.frameElement as HTMLElement | null
      if (!frame) return { x, y }
      const box = frame.getBoundingClientRect()
      const k = frame.offsetWidth ? box.width / frame.offsetWidth : 1
      return { x: box.left + x * k, y: box.top + y * k }
    }
    const alive = () => {
      const frame = doc.defaultView?.frameElement
      return !!doc.defaultView && (!frame || frame.isConnected)
    }
    const points = (list: TouchList): TouchPoint[] =>
      Array.from(list, (t) => ({ id: t.identifier, ...toWindow(t.clientX, t.clientY), alive }))
    const onTouch = (type: 'start' | 'move' | 'end' | 'cancel') => (e: Event) => {
      const pinch = this.tracker.touch(type, points((e as TouchEvent).changedTouches))
      // One finger scrolls, as ever; two are ours, and neither the page nor iOS moves for them.
      if (pinch && e.cancelable && type !== 'end') e.preventDefault()
    }
    target.addEventListener('touchstart', onTouch('start'), { passive: false })
    target.addEventListener('touchmove', onTouch('move'), { passive: false })
    target.addEventListener('touchend', onTouch('end'))
    target.addEventListener('touchcancel', onTouch('cancel'))
    // Safari's own pinch, which would zoom the whole app.
    target.addEventListener('gesturestart', (e) => e.preventDefault())
    target.addEventListener(
      'wheel',
      (e) => {
        const w = e as WheelEvent
        if (w.ctrlKey || w.metaKey) this.wheel(w, toWindow(w.clientX, w.clientY))
      },
      { passive: false }
    )
  }

  /** The drawing sheet's own two fingers: it hears every touch, and hands a pinch here. */
  get pinch(): PinchTracker {
    return this.tracker
  }

  destroy(): void {
    window.clearTimeout(this.wheelTimer)
    this.wheelTimer = 0
    this.show(null)
  }
}

const STORE = 'abele-pdf-zoom'

/** The zoom of the PDF a book tab shows, kept for the book in this device's storage. */
export function zoomFor(
  view: {
    app: {
      loadLocalStorage(key: string): unknown
      saveLocalStorage(key: string, value: unknown): void
    }
    model: { zoom: number }
  },
  engine: HTMLElement & { renderer?: unknown },
  key: string
): PdfZoom {
  const memory = new ZoomMemory(
    () => {
      const saved = view.app.loadLocalStorage(STORE)
      return typeof saved === 'string' ? saved : null
    },
    (value) => view.app.saveLocalStorage(STORE, value)
  )
  return new PdfZoom(
    {
      engine: () => engine,
      renderer: () => (engine.renderer as HTMLElement | undefined) ?? null,
      setting: () => pdfZoomFor(readerSettingsFrom(AbeleConfig.getInstance().reader)),
      changed: (scale) => (view.model.zoom = scale),
    },
    memory,
    key
  )
}
