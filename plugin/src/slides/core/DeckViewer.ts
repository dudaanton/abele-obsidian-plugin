import { scopeCss } from '@/scripting/view/scopeCss'
import type { BlockRenderer, Deck, FullscreenHost, MediaResolver, Slide } from './model'
import {
  fitSlide,
  navigate,
  slideForGesture,
  slideForKey,
  type Navigation,
  type Point,
} from './navigation'

interface RenderedSlide {
  element: HTMLElement
  cleanups: (() => void)[]
  gone: boolean
  ready: Promise<void>
  observer: MutationObserver
  attempted: WeakSet<HTMLVideoElement>
}

const interactive = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  !!target.closest(
    'input, textarea, select, button, a, video, audio, iframe, [contenteditable="true"], .abele-map, .abele-chart-container, .abele-gallery-widget-container'
  )

/** A bounded DOM viewer, independent of any app, renderer or file system. */
export class DeckViewer {
  readonly root: HTMLElement
  readonly viewport: HTMLElement
  readonly toolbar: HTMLElement
  ready: Promise<void> = Promise.resolve()
  index = 0
  private deck: Deck | null = null
  private readonly slides = new Map<number, RenderedSlide>()
  private readonly count: HTMLElement
  private readonly previous: HTMLButtonElement
  private readonly next: HTMLButtonElement
  private readonly play: HTMLButtonElement
  private readonly stylesheet: HTMLStyleElement
  private readonly resize: ResizeObserver
  private readonly abort = new AbortController()
  private readonly scopeId: string
  private placeholder: Comment | null = null
  private focusBefore: HTMLElement | null = null
  private fullscreenOwned = false
  private closed = false
  private revision = 0
  private gesture: { start: Point; id: number } | null = null

  constructor(
    host: HTMLElement,
    private readonly renderer: BlockRenderer,
    private readonly media: MediaResolver,
    private readonly options: { fullscreen?: boolean; fullscreenHost?: FullscreenHost } = {}
  ) {
    const doc = host.ownerDocument
    this.root = doc.createElement('div')
    this.root.className = 'abele-deck'
    this.root.tabIndex = 0
    this.root.setAttribute('aria-label', 'Presentation')
    this.scopeId = `deck-${Math.random().toString(36).slice(2)}`
    this.root.dataset.deckId = this.scopeId
    this.stylesheet = doc.createElement('style')
    this.toolbar = doc.createElement('div')
    this.toolbar.className = 'abele-deck-toolbar'
    this.previous = this.button('Previous slide', () => void this.go('previous'))
    this.previous.textContent = '←'
    this.count = doc.createElement('span')
    this.count.className = 'abele-deck-count'
    this.count.setAttribute('aria-live', 'polite')
    this.toolbar.append(this.count)
    this.next = this.button('Next slide', () => void this.go('next'))
    this.next.textContent = '→'
    this.play = this.button('Play', () => {
      if (this.placeholder) this.exitPresenting()
      else void this.present(options.fullscreen !== false)
    })
    this.viewport = doc.createElement('div')
    this.viewport.className = 'abele-deck-viewport'
    this.root.append(this.stylesheet, this.toolbar, this.viewport)
    host.append(this.root)
    this.resize = new ResizeObserver(() => this.scale())
    this.resize.observe(this.viewport)
    const listen = { signal: this.abort.signal }
    this.root.addEventListener('keydown', this.handleKey, { ...listen, capture: true })
    // In presenting mode the overlay owns the window, including focus accidentally left outside it.
    doc.addEventListener('keydown', this.onWindowKey, { ...listen, capture: true })
    doc.addEventListener(
      'fullscreenchange',
      () => {
        if (!options.fullscreenHost && this.fullscreenOwned && doc.fullscreenElement !== this.root)
          this.exitPresenting()
      },
      listen
    )
    const unwatchFullscreen = options.fullscreenHost?.watchExited?.(() => this.exitPresenting())
    this.abort.signal.addEventListener('abort', () => unwatchFullscreen?.(), { once: true })
    this.viewport.addEventListener('pointerdown', this.onPointerDown, listen)
    this.viewport.addEventListener('pointerup', this.onPointerUp, listen)
    this.viewport.addEventListener(
      'pointercancel',
      () => {
        this.gesture = null
      },
      listen
    )
  }

  button(label: string, action: () => void): HTMLButtonElement {
    const button = this.root.ownerDocument.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.setAttribute('aria-label', label)
    button.addEventListener('click', action, { signal: this.abort.signal })
    this.toolbar.append(button)
    return button
  }

  setDeck(deck: Deck): Promise<void> {
    if (this.closed) return Promise.resolve()
    const revision = ++this.revision
    for (const entry of this.slides.values()) this.release(entry)
    this.slides.clear()
    this.deck = deck
    this.index = navigate(this.index, this.index, deck.slides.length)
    this.stylesheet.textContent = ''
    const render = this.update()
    const styles = (async () => {
      let theme = ''
      if (deck.settings.theme && deck.settings.theme !== 'default') {
        try {
          theme = await this.media.readCss(deck.settings.theme)
        } catch (error) {
          console.warn('[Abele] presentation theme could not be read', error)
        }
      }
      if (this.closed || revision !== this.revision) return
      this.stylesheet.textContent = scopeCss(
        `${theme}\n${deck.css}`,
        `[data-deck-id="${this.scopeId}"] .abele-slide`
      )
    })()
    this.ready = Promise.all([render, styles]).then(() => {})
    return this.ready
  }

  go(action: Navigation): Promise<void> {
    if (!this.deck || this.closed) return Promise.resolve()
    const next = navigate(this.index, action, this.deck.slides.length)
    if (next === this.index) return this.ready
    const old = this.slides.get(this.index)
    if (old) {
      this.pause(old)
      old.attempted = new WeakSet()
    }
    this.index = next
    this.ready = this.update()
    return this.ready
  }

  private update(): Promise<void> {
    const deck = this.deck!
    const wanted = [this.index - 1, this.index, this.index + 1].filter(
      (i) => i >= 0 && i < deck.slides.length
    )
    for (const [i, entry] of this.slides) {
      if (!wanted.includes(i)) {
        this.release(entry)
        this.slides.delete(i)
      }
    }
    for (const i of wanted) {
      if (!this.slides.has(i)) this.slides.set(i, this.mount(deck.slides[i], i))
    }
    for (const [i, entry] of this.slides) {
      entry.element.hidden = i !== this.index
      entry.element.setAttribute('aria-hidden', String(i !== this.index))
      if (i !== this.index) this.pause(entry)
    }
    this.count.textContent = `${this.index + 1} / ${deck.slides.length}`
    this.previous.disabled = this.index === 0
    this.next.disabled = this.index >= deck.slides.length - 1
    this.scale()
    return Promise.all(wanted.map((i) => this.slides.get(i)!.ready)).then(() => {
      if (this.closed) return
      const active = this.slides.get(this.index)
      if (active) this.activate(active)
    })
  }

  private mount(slide: Slide, index: number): RenderedSlide {
    const doc = this.root.ownerDocument
    const element = doc.createElement('section')
    element.className = `abele-slide abele-slide-${slide.settings.layout}`
    for (const name of slide.settings.className.split(/\s+/).filter(Boolean))
      element.classList.add(name)
    element.dataset.slide = String(index + 1)
    if (slide.settings.layout === 'grid') {
      element.style.setProperty(
        '--deck-columns',
        String(
          Math.max(1, Math.ceil(Math.sqrt(slide.regions.filter((r) => r.name === 'cell').length)))
        )
      )
    }
    element.hidden = index !== this.index
    const background = this.media.resolve(slide.settings.bg)
    if (background) {
      const el = doc.createElement(background.video ? 'video' : 'img')
      el.className = 'abele-slide-background'
      el.src = background.url
      el.style.objectFit = slide.settings.fit
      if (el instanceof HTMLVideoElement) {
        el.loop = true
        el.controls = true
      } else el.alt = ''
      element.append(el)
    }
    if (background && slide.settings.dim) {
      const dim = doc.createElement('div')
      dim.className = 'abele-slide-dim'
      dim.style.opacity = String(slide.settings.dim)
      element.append(dim)
    }
    const content = doc.createElement('div')
    content.className = 'abele-slide-content markdown-rendered'
    element.append(content)
    const observer = new MutationObserver(() => {
      if (entry.gone) return
      if (!element.hidden) this.activate(entry)
      else this.pause(entry)
    })
    const entry: RenderedSlide = {
      element,
      cleanups: [],
      gone: false,
      ready: Promise.resolve(),
      observer,
      attempted: new WeakSet(),
    }
    observer.observe(element, { childList: true, subtree: true })
    this.viewport.append(element)
    entry.ready = Promise.all(
      slide.regions.map(async (region) => {
        const target = doc.createElement('div')
        target.className = `abele-slide-region abele-slide-region-${region.name}`
        content.append(target)
        for (const block of region.blocks) {
          if (entry.gone) break
          const el = doc.createElement('div')
          target.append(el)
          try {
            const cleanup = await this.renderer.render(block, el)
            if (entry.gone) cleanup()
            else entry.cleanups.push(cleanup)
          } catch (error) {
            if (!entry.gone)
              el.textContent = `Slide could not be rendered: ${error instanceof Error ? error.message : error}`
          }
        }
      })
    ).then(() => {
      if (!entry.gone) {
        if (!element.hidden) this.activate(entry)
        else this.pause(entry)
      }
    })
    return entry
  }

  private activate(entry: RenderedSlide): void {
    const index = Number(entry.element.dataset.slide) - 1
    const autoplay = this.deck?.slides[index]?.settings.autoplay
    for (const video of Array.from(entry.element.querySelectorAll('video'))) {
      video.autoplay = false
      video.playsInline = true
      video.setAttribute('playsinline', '')
      if (!autoplay || entry.attempted.has(video)) continue
      entry.attempted.add(video)
      video.muted = true
      video.setAttribute('muted', '')
      void video
        .play()
        .then(() => {
          if (entry.gone || entry.element.hidden || this.closed) video.pause()
        })
        .catch(() => {
          if (
            entry.gone ||
            entry.element.hidden ||
            video.parentElement?.querySelector('.abele-slide-play')
          )
            return
          const button = this.root.ownerDocument.createElement('button')
          button.type = 'button'
          button.className = 'abele-slide-play'
          button.textContent = 'Play video'
          button.addEventListener(
            'click',
            () => {
              void video
                .play()
                .then(() => {
                  if (entry.gone || entry.element.hidden || this.closed) video.pause()
                  button.remove()
                })
                .catch(() => {})
            },
            { signal: this.abort.signal }
          )
          entry.element.append(button)
        })
    }
  }

  private pause(entry: RenderedSlide): void {
    for (const video of Array.from(entry.element.querySelectorAll('video'))) {
      video.autoplay = false
      video.pause()
    }
    for (const audio of Array.from(entry.element.querySelectorAll('audio'))) audio.pause()
  }

  private release(entry: RenderedSlide): void {
    if (entry.gone) return
    entry.gone = true
    entry.observer.disconnect()
    this.pause(entry)
    entry.cleanups.splice(0).forEach((cleanup) => cleanup())
    entry.element.remove()
  }

  private scale(): void {
    if (!this.deck) return
    const size = fitSlide(
      this.viewport.clientWidth,
      this.viewport.clientHeight,
      this.deck.settings.aspect
    )
    for (const { element } of this.slides.values()) {
      element.style.width = `${size.width}px`
      element.style.height = `${size.height}px`
      element.style.transform = `translate(${size.x}px, ${size.y}px) scale(${size.scale})`
    }
  }

  async present(fullscreen: boolean): Promise<void> {
    if (this.placeholder || this.closed) return
    const doc = this.root.ownerDocument
    this.focusBefore = doc.activeElement as HTMLElement | null
    this.placeholder = doc.createComment('presentation tab')
    this.root.before(this.placeholder)
    doc.body.append(this.root)
    this.root.classList.add('abele-deck-presenting')
    this.play.textContent = 'Exit'
    this.play.setAttribute('aria-label', 'Exit presentation')
    this.root.focus()
    this.scale()
    const host = this.options.fullscreenHost
    if (fullscreen && (host || this.root.requestFullscreen)) {
      try {
        if (host) await host.enter()
        else await this.root.requestFullscreen()
        if (this.closed || !this.placeholder) {
          if (host) await host.exit()
          else if (doc.fullscreenElement === this.root) await doc.exitFullscreen()
        } else this.fullscreenOwned = true
      } catch {
        /* The full-window surface remains usable when element fullscreen is unavailable. */
      }
    }
  }

  exitPresenting(): void {
    if (!this.placeholder) return
    const doc = this.root.ownerDocument
    this.placeholder.replaceWith(this.root)
    this.placeholder = null
    this.root.classList.remove('abele-deck-presenting')
    this.play.textContent = 'Play'
    this.play.setAttribute('aria-label', 'Play')
    if (this.fullscreenOwned) {
      if (this.options.fullscreenHost) void this.options.fullscreenHost.exit().catch(() => {})
      else if (doc.fullscreenElement === this.root) void doc.exitFullscreen().catch(() => {})
    }
    this.fullscreenOwned = false
    this.focusBefore?.focus()
    this.focusBefore = null
    this.scale()
  }

  private onWindowKey = (event: KeyboardEvent): void => {
    if (this.placeholder) this.handleKey(event)
  }
  /** Hosts with a capture-phase hotkey scope can forward navigation before swallowing the key. */
  handleKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
    if (event.key === 'Escape' && this.placeholder) {
      event.preventDefault()
      event.stopPropagation()
      this.exitPresenting()
      return
    }
    if (interactive(event.target)) return
    const action = slideForKey(event.key)
    if (action === null) return
    event.preventDefault()
    event.stopPropagation()
    void this.go(action)
  }
  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || !event.isPrimary || interactive(event.target)) return
    const box = this.viewport.getBoundingClientRect()
    this.gesture = {
      start: { x: event.clientX - box.left, y: event.clientY - box.top },
      id: event.pointerId,
    }
  }
  private onPointerUp = (event: PointerEvent): void => {
    const gesture = this.gesture
    this.gesture = null
    if (!gesture || gesture.id !== event.pointerId || interactive(event.target)) return
    const box = this.viewport.getBoundingClientRect()
    const action = slideForGesture(
      gesture.start,
      { x: event.clientX - box.left, y: event.clientY - box.top },
      box.width
    )
    if (action !== null) {
      event.preventDefault()
      void this.go(action)
    }
  }

  destroy(): void {
    if (this.closed) return
    this.closed = true
    this.exitPresenting()
    this.abort.abort()
    this.resize.disconnect()
    for (const entry of this.slides.values()) this.release(entry)
    this.slides.clear()
    this.root.remove()
  }
}
