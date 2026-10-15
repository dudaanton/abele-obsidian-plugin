/** DOM viewer with an optional editor input adapter; vault and rendering behavior comes through ports. */
import { fitRect, panBy, toWorld, visibleRect, zoomAt, type Camera } from '../drawing/camera'
import { guardSurface } from '../reader/ink/inkGuard'
import { emptyCanvas, overlaps, type CanvasGraph, type CanvasNode, type Rect } from './core/model'
import {
  paintCanvas,
  paintCanvasInk,
  pictureRegion,
  withoutLiveCardAssets,
  type CanvasAssets,
  type CanvasTheme,
} from './core/painter'
import { stepScene, stepsOf, type CanvasStep } from './core/steps'
import { canvasVisibility } from './core/visibility'

export interface ViewerCards {
  sync(
    graph: CanvasGraph,
    camera: Camera,
    width: number,
    height: number,
    highlight: ReadonlySet<string>,
    assets: CanvasAssets,
    theme: CanvasTheme
  ): ReadonlySet<string>
  /** Scrolls a card's own words by screen pixels; whether they moved, so the canvas stays put. */
  scroll?(id: string, dx: number, dy: number): boolean
  destroy(): void
  /** A card's own scrolling body, for a long note read inside its card. */
  scroller?(id: string): HTMLElement | null
}
export interface CanvasViewerPorts {
  theme(): CanvasTheme
  assets(graph: CanvasGraph, region: Rect, signal: AbortSignal): Promise<CanvasAssets>
  cards: ViewerCards
  openNode(node: CanvasNode): void
}
export interface CanvasViewerInput {
  down(event: PointerEvent): boolean
  move(event: PointerEvent): void
  up(event: PointerEvent): void
  cancel(): void
  paint(): void
  paintInk?(ctx: CanvasRenderingContext2D, theme: CanvasTheme): void
  ignores?(event: PointerEvent): boolean
  /** A pointer moving over the stage with nothing pressed. */
  hover?(event: PointerEvent): void
}
export class CanvasViewer {
  readonly stage: HTMLElement
  readonly canvas: HTMLCanvasElement
  readonly inkCanvas: HTMLCanvasElement
  readonly narration: HTMLElement
  readonly status: HTMLElement
  camera: Camera = { x: 0, y: 0, zoom: 1 }
  step: number | null = null
  graph: CanvasGraph = emptyCanvas()
  selection: ReadonlySet<string> = new Set()
  onSelect?: (node: CanvasNode | null) => void
  onEditorKey?: (event: KeyboardEvent) => boolean
  /** Two or three fingers tapped together and lifted without moving: undo and redo on iPad. */
  onFingersTap?: (fingers: number) => void
  /** A second press in the same place soon after the first: a double click or a double tap. */
  onDoubleTap?: (event: PointerEvent) => void
  /** The wheel turned over the canvas; true when the host used it, so the camera stays. */
  onWheel?: (event: WheelEvent) => boolean
  /** The last press that was a tap, for telling a double tap. */
  private lastTap: { x: number; y: number; time: number; type: string } | null = null
  input?: CanvasViewerInput
  /** The connection whose label is being written over it by the host. */
  writingLabel: string | null = null
  /** The host draws each frame's name as a label of its own; the surface paints only the frame. */
  groupLabels = false
  /** Screen height at the stage's top covered by the host's tools: framing keeps clear of it. */
  insetTop = 0
  openNode(node: CanvasNode): void {
    this.ports.openNode(node)
  }
  private steps: CanvasStep[] = []
  private readonly off: (() => void)[] = []
  private readonly resize: ResizeObserver
  private readonly previous: HTMLButtonElement
  private readonly next: HTMLButtonElement
  private readonly play: HTMLButtonElement
  private readonly counter: HTMLElement
  private frame = 0
  private inkFrame = 0
  private animation = 0
  private destroyed = false
  private assets: CanvasAssets = {}
  private assetsKey = ''
  private abort: AbortController | null = null
  private fitted = false
  private pendingFocus: Rect | null = null
  private framedRegion: Rect | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private gesture: {
    x: number
    y: number
    time: number
    multi: boolean
    touch: boolean
    /** Started by a pen, not a finger. */
    pen: boolean
    camera: Camera
    editing: boolean
    /** The most fingers down at once, and whether any of them travelled. */
    fingers: number
    moved: boolean
  } | null = null
  private error = ''

  constructor(
    readonly el: HTMLElement,
    private readonly ports: CanvasViewerPorts
  ) {
    const doc = el.ownerDocument
    el.classList.add('abele-canvas-viewer')
    el.tabIndex = 0
    const make = (tag: string, cls: string, parent: HTMLElement) => {
      const child = doc.createElementNS('http://www.w3.org/1999/xhtml', tag)
      child.className = cls
      parent.append(child)
      return child
    }
    const bar = make('div', 'abele-canvas-controls', el)
    const button = (label: string, text: string, action: () => void) => {
      const b = make('button', '', bar) as HTMLButtonElement
      b.type = 'button'
      b.setAttribute('aria-label', label)
      b.title = label
      b.textContent = text
      this.listen(b, 'click', () => action())
      return b
    }
    this.previous = button('Previous step', '←', () => this.advance(-1))
    this.play = button('Play walkthrough', 'Play', () => this.go(this.step ?? 1))
    this.next = button('Next step', '→', () => this.advance(1))
    this.counter = make('span', 'abele-canvas-counter', bar)
    button('Show whole diagram', 'All', () => this.go(null))
    button('Fit diagram', 'Fit', () => this.fit(false))
    this.stage = make('div', 'abele-canvas-stage', el)
    this.canvas = make('canvas', 'abele-canvas-surface', this.stage) as HTMLCanvasElement
    // Said to a screen reader, not shown: Obsidian turns an aria-label into a tooltip that
    // would follow the pen and mouse over the whole canvas.
    this.canvas.setAttribute('role', 'img')
    this.canvas.setAttribute(
      'aria-description',
      'Diagram; drag to pan, pinch or wheel to zoom, swipe to change step'
    )
    this.inkCanvas = make(
      'canvas',
      'abele-canvas-surface abele-canvas-ink',
      this.stage
    ) as HTMLCanvasElement
    this.narration = make('div', 'abele-canvas-narration', el)
    this.narration.setAttribute('aria-live', 'polite')
    this.status = make('div', 'abele-canvas-status', el)
    this.status.setAttribute('role', 'status')
    this.off.push(guardSurface(this.stage))
    this.listen(el, 'keydown', (e) => this.handleKey(e as KeyboardEvent))
    this.listen(this.stage, 'pointerdown', (e) => this.down(e as PointerEvent))
    this.listen(this.stage, 'pointermove', (e) => this.move(e as PointerEvent))
    this.listen(this.stage, 'pointerup', (e) => this.up(e as PointerEvent, false))
    this.listen(this.stage, 'pointercancel', (e) => this.up(e as PointerEvent, true))
    this.listen(this.stage, 'lostpointercapture', (e) => this.up(e as PointerEvent, true))
    this.listen(this.stage, 'wheel', (e) => this.wheel(e as WheelEvent), { passive: false })
    this.resize = new ResizeObserver(() => {
      if (this.stage.clientWidth && this.stage.clientHeight && this.pendingFocus)
        this.focusRegion(this.pendingFocus, false)
      else if (!this.fitted && this.stage.clientWidth && this.stage.clientHeight) this.fit(false)
      else if (this.framedRegion) this.focusRegion(this.framedRegion, false)
      else this.draw()
    })
    this.resize.observe(this.stage)
  }
  private listen(
    el: HTMLElement,
    type: string,
    fn: EventListener,
    opts?: AddEventListenerOptions
  ): void {
    el.addEventListener(type, fn, opts)
    this.off.push(() => el.removeEventListener(type, fn, opts))
  }
  load(graph: CanvasGraph, reset = false): void {
    const id = reset || this.step === null ? null : this.steps[this.step - 1]?.id
    if (reset) {
      this.fitted = false
      this.pendingFocus = null
      this.framedRegion = null
    }
    this.graph = graph
    this.error = ''
    try {
      this.steps = stepsOf(graph)
    } catch (error) {
      this.steps = []
      this.error = String(error)
    }
    this.step = id ? this.steps.findIndex((s) => s.id === id) + 1 || null : null
    this.assetsKey = ''
    this.abort?.abort()
    this.assets = {}
    this.controls()
    if (!this.fitted || this.step !== null) this.fit(false)
    else this.draw()
  }
  scene() {
    return this.step === null
      ? {
          graph: this.graph,
          region: pictureRegion(this.graph),
          highlight: new Set<string>(),
          say: '',
        }
      : stepScene(this.graph, this.step)
  }
  go(number: number | null, animate = true): void {
    if (this.destroyed) return
    this.cancelInput()
    if (number !== null && (!Number.isInteger(number) || number < 1 || number > this.steps.length))
      return
    this.step = number
    this.error = ''
    this.controls()
    this.fit(animate)
  }
  private advance(delta: number): void {
    if (!this.steps.length) return
    this.go(Math.max(1, Math.min(this.steps.length, (this.step ?? (delta > 0 ? 0 : 2)) + delta)))
  }
  private controls(): void {
    this.previous.disabled = !this.steps.length || this.step === 1
    this.next.disabled = !this.steps.length || this.step === this.steps.length
    this.play.disabled = !this.steps.length
    this.counter.textContent =
      this.step === null ? `${this.steps.length} steps` : `${this.step} / ${this.steps.length}`
    this.narration.textContent = this.step === null ? '' : (this.steps[this.step - 1]?.say ?? '')
    this.status.textContent = this.error
    this.el.dataset.step = this.step === null ? 'all' : String(this.step)
  }
  fit(animate = true): void {
    this.cancelInput()
    let region: Rect
    try {
      region = this.scene().region
      if (this.step === null && !this.fitted) {
        const start = (this.graph.metadata as { startNode?: unknown } | undefined)?.startNode
        if (typeof start === 'string' && this.graph.nodes.some((n) => n.id === start))
          region = pictureRegion(this.graph, { node: start })
      }
    } catch (error) {
      this.error = String(error)
      this.step = null
      this.controls()
      region = pictureRegion(this.graph)
    }
    this.focusRegion(region, animate)
  }
  focusRegion(region: Rect, animate = false): void {
    this.cancelInput()
    this.framedRegion = { ...region }
    this.pendingFocus = { ...region }
    const width = this.stage.clientWidth,
      height = this.stage.clientHeight
    if (!width || !height) {
      this.fitted = false
      return
    }
    this.pendingFocus = null
    this.fitted = true
    const top = Math.min(this.insetTop, height / 2),
      target = fitRect(
        { x: region.x, y: region.y, w: region.width, h: region.height },
        width,
        height - top,
        // An empty canvas opens at its own size, not magnified twice over.
        this.graph.nodes.length ? 2 : 1,
        16
      )
    target.y -= top / target.zoom
    this.stopAnimation()
    const win = this.el.ownerDocument.defaultView
    if (!animate || win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera = target
      this.draw()
      return
    }
    const from = { ...this.camera },
      start = win.performance.now()
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / 240),
        k = t * t * (3 - 2 * t)
      this.camera = {
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        zoom: from.zoom + (target.zoom - from.zoom) * k,
      }
      this.draw()
      this.animation = t < 1 ? win.requestAnimationFrame(frame) : 0
    }
    this.animation = win.requestAnimationFrame(frame)
  }
  setCamera(camera: Camera): void {
    this.cancelInput()
    this.pendingFocus = null
    this.framedRegion = null
    this.stopAnimation()
    this.camera = { ...camera }
    this.fitted = true
    this.draw()
  }
  /**
   * Moves the camera the least it takes for a region to show whole, kept clear of the given
   * screen margins (the tools floating at the foot), without changing the zoom.
   */
  reveal(region: Rect, inset: { top?: number; bottom?: number; side?: number } = {}): void {
    const width = this.stage.clientWidth,
      height = this.stage.clientHeight,
      zoom = this.camera.zoom
    if (!width || !height) return
    const top = (inset.top ?? 16) + this.insetTop,
      bottom = inset.bottom ?? 16,
      side = inset.side ?? 16
    const sx = (region.x - this.camera.x) * zoom,
      sy = (region.y - this.camera.y) * zoom,
      ex = sx + region.width * zoom,
      ey = sy + region.height * zoom
    const dx = sx < side ? sx - side : ex > width - side ? ex - (width - side) : 0
    const dy = sy < top ? sy - top : ey > height - bottom ? ey - (height - bottom) : 0
    if (dx || dy)
      this.setCamera({ x: this.camera.x + dx / zoom, y: this.camera.y + dy / zoom, zoom })
  }
  private stopAnimation(): void {
    if (this.animation) this.el.ownerDocument.defaultView.cancelAnimationFrame(this.animation)
    this.animation = 0
  }
  visible(): Rect {
    const r = visibleRect(this.camera, this.stage.clientWidth, this.stage.clientHeight)
    return { x: r.x, y: r.y, width: r.w, height: r.h }
  }
  draw(): void {
    if (this.destroyed || this.frame) return
    this.frame = this.el.ownerDocument.defaultView.requestAnimationFrame(() => {
      this.frame = 0
      this.paint()
    })
  }
  /** Pen sampling repaints only the ink plane, not Markdown cards or asset loads. */
  drawInk(): void {
    if (this.destroyed || this.inkFrame) return
    this.inkFrame = this.el.ownerDocument.defaultView.requestAnimationFrame(() => {
      this.inkFrame = 0
      this.paintInk()
    })
  }
  private paintInk(): void {
    const width = this.stage.clientWidth,
      height = this.stage.clientHeight
    if (this.destroyed || !width || !height) return
    const ratio = this.el.ownerDocument.defaultView.devicePixelRatio || 1
    this.inkCanvas.width = Math.max(1, Math.round(width * ratio))
    this.inkCanvas.height = Math.max(1, Math.round(height * ratio))
    const ctx = this.inkCanvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(
      ratio * this.camera.zoom,
      0,
      0,
      ratio * this.camera.zoom,
      -this.camera.x * ratio * this.camera.zoom,
      -this.camera.y * ratio * this.camera.zoom
    )
    const theme = this.ports.theme()
    const scene = this.scene()
    paintCanvasInk(ctx, scene.graph, this.visible(), theme, scene.highlight)
    if (this.step === null) this.input?.paintInk?.(ctx, theme)
  }
  private paint(): void {
    if (this.destroyed) return
    const width = this.stage.clientWidth,
      height = this.stage.clientHeight
    if (!width || !height) return
    const scene = this.scene(),
      region = this.visible(),
      ratio = this.el.ownerDocument.defaultView.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.round(width * ratio))
    this.canvas.height = Math.max(1, Math.round(height * ratio))
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(
      ratio * this.camera.zoom,
      0,
      0,
      ratio * this.camera.zoom,
      -this.camera.x * ratio * this.camera.zoom,
      -this.camera.y * ratio * this.camera.zoom
    )
    const theme = this.ports.theme(),
      highlight = new Set([...scene.highlight, ...this.selection])
    const live = this.ports.cards.sync(
      scene.graph,
      this.camera,
      width,
      height,
      highlight,
      this.assets,
      theme
    )
    paintCanvas(ctx, scene.graph, region, theme, {
      ...withoutLiveCardAssets(this.assets, live),
      highlight,
      lint: false,
      skipCards: true,
      skipInk: true,
      skipGroupLabels: this.groupLabels,
      omitLabel: this.writingLabel,
    })
    this.paintInk()
    this.input?.paint()
    const key = scene.graph.nodes
      .filter((n) => overlaps(n, region))
      .map((n) => n.id)
      .join('\0')
    if (key !== this.assetsKey) {
      this.assetsKey = key
      this.abort?.abort()
      this.abort = new AbortController()
      const signal = this.abort.signal
      void this.ports
        .assets(scene.graph, region, signal)
        .then((assets) => {
          if (this.destroyed || signal.aborted) return
          this.assets = assets
          this.draw()
        })
        .catch((error) => {
          if (!signal.aborted && !this.destroyed) {
            this.status.textContent = String(error)
          }
        })
    }
  }
  handleKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement
    if (
      target?.closest('input,textarea,select,[contenteditable=true]') ||
      (e.key === ' ' && target?.closest('button'))
    )
      return
    if (this.onEditorKey?.(e)) return
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') this.advance(1)
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.advance(-1)
    else if (e.key === 'Home') this.go(this.steps.length ? 1 : null)
    else if (e.key === 'End') this.go(this.steps.length || null)
    else if (e.key === 'Escape') this.go(null)
    else return
    e.preventDefault()
    e.stopPropagation()
  }
  /** A card's scrolling body, when the host's cards have one. */
  scroller(id: string): HTMLElement | null {
    return this.ports.cards.scroller?.(id) ?? null
  }
  private down(e: PointerEvent): void {
    // The middle button moves the canvas whatever tool is in hand.
    const middle = e.pointerType === 'mouse' && e.button === 1
    if ((e.button !== 0 && !middle && e.pointerType === 'mouse') || this.input?.ignores?.(e)) return
    e.stopPropagation()
    this.stopAnimation()
    this.framedRegion = null
    if (e.pointerType === 'mouse') this.el.focus({ preventScroll: true })
    // A pen landing while only fingers are down: those fingers are the hand resting on the
    // screen. They are let go of, the canvas goes back to where it was, and the pen draws.
    if (e.pointerType === 'pen' && this.gesture?.touch && !this.gesture.pen) {
      this.input?.cancel()
      this.camera = this.gesture.camera
      this.pointers.clear()
      this.gesture = null
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (!this.gesture)
      this.gesture = {
        x: e.clientX,
        y: e.clientY,
        time: Date.now(),
        multi: false,
        touch: e.pointerType !== 'mouse',
        pen: e.pointerType === 'pen',
        camera: { ...this.camera },
        editing: !middle && this.step === null && !!this.input?.down(e),
        fingers: 1,
        moved: false,
      }
    else {
      this.gesture.multi = true
      this.gesture.fingers = Math.max(this.gesture.fingers, this.pointers.size)
      this.input?.cancel()
    }
    try {
      this.stage.setPointerCapture(e.pointerId)
    } catch {
      /* Follow while the pointer is on the stage. */
    }
  }
  private move(e: PointerEvent): void {
    const was = this.pointers.get(e.pointerId)
    if (!was) {
      if (!this.pointers.size && this.step === null) this.input?.hover?.(e)
      return
    }
    e.stopPropagation()
    if (this.gesture?.editing && !this.gesture.multi) {
      this.input?.move(e)
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      return
    }
    // A pen draws or does nothing: it never carries the canvas, even when it could not draw.
    if (this.gesture?.pen && !this.gesture.multi) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      return
    }
    this.framedRegion = null
    if (this.gesture && Math.hypot(e.clientX - this.gesture.x, e.clientY - this.gesture.y) > 12)
      this.gesture.moved = true
    const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)?.[1]
    const rect = this.stage.getBoundingClientRect()
    if (other) {
      const before = Math.hypot(was.x - other.x, was.y - other.y),
        after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      if (before > 4 && after > 4)
        this.camera = zoomAt(
          this.camera,
          (was.x + other.x) / 2 - rect.left,
          (was.y + other.y) / 2 - rect.top,
          after / before
        )
    }
    this.camera = panBy(
      this.camera,
      (e.clientX - was.x) / (other ? 2 : 1),
      (e.clientY - was.y) / (other ? 2 : 1)
    )
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.draw()
  }
  private up(e: PointerEvent, cancel: boolean): void {
    if (!this.pointers.has(e.pointerId)) return
    e.stopPropagation()
    this.pointers.delete(e.pointerId)
    const gesture = this.gesture
    if (cancel) {
      this.input?.cancel()
      if (gesture) gesture.multi = true
    }
    if (this.pointers.size || !gesture) return
    this.gesture = null
    this.tapped(e, gesture, cancel)
    if (
      !cancel &&
      gesture.touch &&
      !gesture.pen &&
      gesture.multi &&
      !gesture.moved &&
      (gesture.fingers === 2 || gesture.fingers === 3) &&
      Date.now() - gesture.time < 400
    ) {
      this.camera = gesture.camera
      this.draw()
      this.onFingersTap?.(gesture.fingers)
      return
    }
    if (cancel || gesture.multi) return
    if (gesture.editing) {
      this.input?.up(e)
      return
    }
    const dx = e.clientX - gesture.x,
      dy = e.clientY - gesture.y
    if (
      gesture.touch &&
      this.step !== null &&
      Math.abs(dx) > 60 &&
      Math.abs(dx) > Math.abs(dy) * 1.5 &&
      Date.now() - gesture.time < 900
    ) {
      this.camera = gesture.camera
      this.advance(dx < 0 ? 1 : -1)
      return
    }
    if (Math.hypot(dx, dy) > 8) return
    const rect = this.stage.getBoundingClientRect(),
      [x, y] = toWorld(this.camera, e.clientX - rect.left, e.clientY - rect.top)
    const node = canvasVisibility(this.scene().graph)
      .visible.reverse()
      .find(
        (n) =>
          n.type !== 'group' && x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height
      )
    if (this.onSelect && this.step === null) this.onSelect(node ?? null)
    else if (node && (node.type === 'file' || node.type === 'link')) this.ports.openNode(node)
    else if (this.step !== null) this.advance(1)
  }
  /**
   * A press let go where it went down, quickly, with one pointer: a tap. A second tap in the same
   * place soon after is a double tap, told to the host after the tap itself has been handled.
   * A pen's taps are dots it draws, so they are not counted.
   */
  private tapped(
    e: PointerEvent,
    gesture: { x: number; y: number; time: number; multi: boolean },
    cancel: boolean
  ): void {
    const now = Date.now()
    if (
      cancel ||
      gesture.multi ||
      e.pointerType === 'pen' ||
      Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 8 ||
      now - gesture.time > 500
    ) {
      this.lastTap = null
      return
    }
    const last = this.lastTap,
      reach = e.pointerType === 'mouse' ? 8 : 24
    if (
      last &&
      last.type === e.pointerType &&
      now - last.time < 450 &&
      Math.hypot(e.clientX - last.x, e.clientY - last.y) <= reach
    ) {
      this.lastTap = null
      const handler = this.onDoubleTap
      if (handler && this.step === null) queueMicrotask(() => !this.destroyed && handler(e))
      return
    }
    this.lastTap = { x: e.clientX, y: e.clientY, time: now, type: e.pointerType }
  }
  private cancelInput(): void {
    this.input?.cancel()
    if (this.gesture) this.gesture.multi = true
  }
  private wheel(e: WheelEvent): void {
    if (this.step === null && !e.ctrlKey && !e.metaKey && this.onWheel?.(e)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    this.cancelInput()
    this.framedRegion = null
    e.preventDefault()
    e.stopPropagation()
    this.stopAnimation()
    const rect = this.stage.getBoundingClientRect()
    if (!e.ctrlKey && !e.metaKey && this.step === null && this.ports.cards.scroll) {
      // Over a note or a card with more words than it shows, the wheel reads on in it first.
      const [x, y] = toWorld(this.camera, e.clientX - rect.left, e.clientY - rect.top)
      const node = canvasVisibility(this.graph)
        .visible.reverse()
        .find(
          (n) =>
            n.type !== 'group' && x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height
        )
      if (node && this.ports.cards.scroll(node.id, e.deltaX, e.deltaY)) return
    }
    this.camera =
      e.ctrlKey || e.metaKey
        ? zoomAt(
            this.camera,
            e.clientX - rect.left,
            e.clientY - rect.top,
            Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.01)
          )
        : panBy(this.camera, -e.deltaX, -e.deltaY)
    this.draw()
  }
  destroy(): void {
    if (this.destroyed) return
    this.cancelInput()
    this.destroyed = true
    this.abort?.abort()
    this.resize.disconnect()
    this.stopAnimation()
    if (this.frame) this.el.ownerDocument.defaultView.cancelAnimationFrame(this.frame)
    if (this.inkFrame) this.el.ownerDocument.defaultView.cancelAnimationFrame(this.inkFrame)
    this.off.splice(0).forEach((fn) => fn())
    this.ports.cards.destroy()
    this.pointers.clear()
    this.el.replaceChildren()
    this.el.classList.remove('abele-canvas-viewer')
  }
}
