/** Read-only DOM viewer. All vault, theme, markdown and file-opening behavior comes through ports. */
import { fitRect, panBy, toWorld, visibleRect, zoomAt, type Camera } from '../drawing/camera'
import { guardSurface } from '../reader/ink/inkGuard'
import {
  canvasPaintOrder,
  emptyCanvas,
  overlaps,
  type CanvasGraph,
  type CanvasNode,
  type Rect,
} from './core/model'
import {
  paintCanvas,
  pictureRegion,
  withoutLiveCardAssets,
  type CanvasAssets,
  type CanvasTheme,
} from './core/painter'
import { stepScene, stepsOf, type CanvasStep } from './core/steps'

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
  destroy(): void
}
export interface CanvasViewerPorts {
  theme(): CanvasTheme
  assets(graph: CanvasGraph, region: Rect, signal: AbortSignal): Promise<CanvasAssets>
  cards: ViewerCards
  openNode(node: CanvasNode): void
}
export class CanvasViewer {
  readonly stage: HTMLElement
  readonly canvas: HTMLCanvasElement
  readonly narration: HTMLElement
  readonly status: HTMLElement
  camera: Camera = { x: 0, y: 0, zoom: 1 }
  step: number | null = null
  graph: CanvasGraph = emptyCanvas()
  private steps: CanvasStep[] = []
  private readonly off: (() => void)[] = []
  private readonly resize: ResizeObserver
  private readonly previous: HTMLButtonElement
  private readonly next: HTMLButtonElement
  private readonly play: HTMLButtonElement
  private readonly counter: HTMLElement
  private frame = 0
  private animation = 0
  private destroyed = false
  private assets: CanvasAssets = {}
  private assetsKey = ''
  private abort: AbortController | null = null
  private fitted = false
  private pointers = new Map<number, { x: number; y: number }>()
  private gesture: {
    x: number
    y: number
    time: number
    multi: boolean
    touch: boolean
    camera: Camera
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
      const child = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement
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
    this.canvas.setAttribute(
      'aria-label',
      'Diagram; drag to pan, pinch or wheel to zoom, swipe to change step'
    )
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
    this.listen(this.stage, 'wheel', (e) => this.wheel(e as WheelEvent), { passive: false })
    this.resize = new ResizeObserver(() => {
      if (!this.fitted && this.stage.clientWidth && this.stage.clientHeight) this.fit(false)
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
    if (reset) this.fitted = false
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
    const width = this.stage.clientWidth,
      height = this.stage.clientHeight
    if (!width || !height) {
      this.fitted = false
      return
    }
    this.fitted = true
    const target = fitRect(
      { x: region.x, y: region.y, w: region.width, h: region.height },
      width,
      height,
      2,
      16
    )
    this.stopAnimation()
    const win = this.el.ownerDocument.defaultView!
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
    this.stopAnimation()
    this.camera = { ...camera }
    this.fitted = true
    this.draw()
  }
  private stopAnimation(): void {
    if (this.animation) this.el.ownerDocument.defaultView!.cancelAnimationFrame(this.animation)
    this.animation = 0
  }
  visible(): Rect {
    const r = visibleRect(this.camera, this.stage.clientWidth, this.stage.clientHeight)
    return { x: r.x, y: r.y, width: r.w, height: r.h }
  }
  draw(): void {
    if (this.destroyed || this.frame) return
    this.frame = this.el.ownerDocument.defaultView!.requestAnimationFrame(() => {
      this.frame = 0
      this.paint()
    })
  }
  private paint(): void {
    if (this.destroyed) return
    const width = this.stage.clientWidth,
      height = this.stage.clientHeight
    if (!width || !height) return
    const scene = this.scene(),
      region = this.visible(),
      ratio = this.el.ownerDocument.defaultView!.devicePixelRatio || 1
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
    const theme = this.ports.theme()
    const live = this.ports.cards.sync(
      scene.graph,
      this.camera,
      width,
      height,
      scene.highlight,
      this.assets,
      theme
    )
    paintCanvas(ctx, scene.graph, region, theme, {
      ...withoutLiveCardAssets(this.assets, live),
      highlight: scene.highlight,
      lint: false,
      skipCards: true,
    })
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
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') this.advance(1)
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.advance(-1)
    else if (e.key === 'Home') this.go(this.steps.length ? 1 : null)
    else if (e.key === 'End') this.go(this.steps.length || null)
    else if (e.key === 'Escape') this.go(null)
    else return
    e.preventDefault()
    e.stopPropagation()
  }
  private down(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.stopPropagation()
    this.stopAnimation()
    if (e.pointerType === 'mouse') this.el.focus({ preventScroll: true })
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (!this.gesture)
      this.gesture = {
        x: e.clientX,
        y: e.clientY,
        time: Date.now(),
        multi: false,
        touch: e.pointerType !== 'mouse',
        camera: { ...this.camera },
      }
    else this.gesture.multi = true
    try {
      this.stage.setPointerCapture(e.pointerId)
    } catch {
      /* Follow while the pointer is on the stage. */
    }
  }
  private move(e: PointerEvent): void {
    const was = this.pointers.get(e.pointerId)
    if (!was) return
    e.stopPropagation()
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
    if (this.pointers.size || !gesture) return
    this.gesture = null
    if (cancel || gesture.multi) return
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
    const node = canvasPaintOrder(this.scene().graph)
      .reverse()
      .find(
        (n) =>
          n.type !== 'group' && x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height
      )
    if (node && (node.type === 'file' || node.type === 'link')) this.ports.openNode(node)
    else if (this.step !== null) this.advance(1)
  }
  private wheel(e: WheelEvent): void {
    e.preventDefault()
    e.stopPropagation()
    this.stopAnimation()
    const rect = this.stage.getBoundingClientRect()
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
    this.destroyed = true
    this.abort?.abort()
    this.resize.disconnect()
    this.stopAnimation()
    if (this.frame) this.el.ownerDocument.defaultView!.cancelAnimationFrame(this.frame)
    this.off.splice(0).forEach((fn) => fn())
    this.ports.cards.destroy()
    this.pointers.clear()
    this.el.replaceChildren()
    this.el.classList.remove('abele-canvas-viewer')
  }
}
