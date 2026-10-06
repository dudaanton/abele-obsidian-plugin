import { scopeCss } from '@/scripting/view/scopeCss'
import type {
  BlockRenderer,
  CssSource,
  Deck,
  FullscreenHost,
  MediaResolver,
  Slide,
  ScriptBlock,
  HtmlBlock,
} from './model'
import { expandCssImports } from './cssImports'
import { staticHtml } from './staticHtml'
import { presentationDeck } from './sources'
import { prepareContentBody, alignShortContentBody } from './contentLayout'
import { Presentation } from './Presentation'
import { fitSlide, slideForGesture, slideForKey, type Navigation, type Point } from './navigation'

interface RenderedSlide {
  /** Model/cache index; the public slide number may be offset in a single-slide export. */
  index: number
  element: HTMLElement
  cleanups: (() => void)[]
  gone: boolean
  ready: Promise<void>
  observer: MutationObserver
  attempted: WeakSet<HTMLVideoElement>
  live: { start: () => Promise<void>; stop: () => void }[]
}

export const interactive = (target: EventTarget | null): boolean => {
  // The event may come from another document whose constructors are not this realm's.
  const element = target as Element | null
  return (
    element?.nodeType === 1 &&
    typeof element.closest === 'function' &&
    !!element.closest(
      'input, textarea, select, button, a, video, audio, iframe, [contenteditable="true"], .abele-map, .abele-chart-container, .abele-gallery-widget-container'
    )
  )
}

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
  private controlsTimer: number | undefined
  private overControls = false
  private closed = false
  private revision = 0
  private gesture: { start: Point; id: number; time: number } | null = null
  private navigation = new Presentation(0)
  private unwatch: () => void = () => {}
  private loading = false
  private following = false
  private mediaSuspended = false

  constructor(
    host: HTMLElement,
    private readonly renderer: BlockRenderer,
    private readonly media: MediaResolver,
    private readonly options: {
      fullscreen?: boolean
      fullscreenHost?: FullscreenHost
      /** Optional native chrome lifetime, also used by full-window shows without fullscreen. */
      presentationHost?: FullscreenHost
      preview?: boolean
      revealAll?: boolean
      /** Original numbering when rendering a subset, used by deck CSS selectors. */
      slideOffset?: number
      onExit?: () => void
      onNotes?: () => void
    } = {}
  ) {
    const doc = host.ownerDocument
    this.root = doc.createElement('div')
    this.root.className = 'abele-deck'
    this.root.tabIndex = 0
    this.root.setAttribute('role', 'region')
    this.scopeId = `deck-${Math.random().toString(36).slice(2)}`
    // Obsidian turns aria-label into a hover tooltip. A referenced hidden label names the
    // region for assistive technology without putting a tooltip over the audience slide.
    const label = doc.createElement('span')
    label.id = `${this.scopeId}-label`
    label.hidden = true
    label.textContent = 'Presentation'
    this.root.setAttribute('aria-labelledby', label.id)
    this.root.dataset.deckId = this.scopeId
    this.stylesheet = doc.createElement('style')
    this.toolbar = doc.createElement('div')
    this.toolbar.className = 'abele-deck-toolbar'
    this.previous = this.button('Previous slide', () => {
      void this.go('previous')
      this.root.focus()
    })
    this.previous.textContent = '←'
    this.count = doc.createElement('span')
    this.count.className = 'abele-deck-count'
    this.count.setAttribute('aria-live', 'polite')
    this.toolbar.append(this.count)
    this.next = this.button('Next slide', () => {
      void this.go('next')
      this.root.focus()
    })
    this.next.textContent = '→'
    this.play = this.button('Play', () => {
      if (this.placeholder) this.exitPresenting()
      else void this.present(options.fullscreen !== false)
    })
    this.viewport = doc.createElement('div')
    this.viewport.className = 'abele-deck-viewport'
    this.root.append(label, this.stylesheet, this.toolbar, this.viewport)
    host.append(this.root)
    this.unwatch = this.navigation.watch(this.syncNavigation)
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
    this.root.addEventListener('pointermove', this.onPointerMove, listen)
    this.root.addEventListener(
      'pointerleave',
      () => {
        this.overControls = false
        this.scheduleControlsHide()
      },
      listen
    )
    this.toolbar.addEventListener('focusin', () => this.showControls(), listen)
    this.toolbar.addEventListener('focusout', () => this.scheduleControlsHide(), listen)
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
    // Single-slide inspection already receives a slice of the derived model.
    if (this.options.slideOffset === undefined) deck = presentationDeck(deck)
    const revision = ++this.revision
    for (const entry of this.slides.values()) this.release(entry)
    this.slides.clear()
    this.deck = deck
    this.loading = true
    if (!this.options.preview || !this.following) this.navigation.resize(deck.slides.length)
    this.index = Math.min(this.navigation.index, Math.max(0, deck.slides.length - 1))
    this.loading = false
    this.stylesheet.textContent = ''
    const render = this.update()
    const styles = (async () => {
      const sources: CssSource[] = []
      if (deck.settings.theme && deck.settings.theme !== 'default') {
        try {
          sources.push(
            this.media.cssImport
              ? await this.media.cssImport(deck.settings.theme)
              : { css: await this.media.readCss(deck.settings.theme), id: deck.settings.theme }
          )
        } catch (error) {
          console.warn('[Abele] presentation theme could not be read', error)
        }
      }
      if (this.closed || revision !== this.revision) return
      sources.push({ css: deck.css, id: '' })
      const resolved = await Promise.all(
        sources.map((source) => expandCssImports(source, this.media.cssImport))
      )
      if (this.closed || revision !== this.revision) return
      this.stylesheet.textContent = scopeCss(
        resolved.join('\n'),
        `[data-deck-id="${this.scopeId}"] .abele-slide`,
        { includeRoot: true }
      )
    })()
    this.ready = Promise.all([render, styles]).then(() => {
      if (this.closed || revision !== this.revision) return
      for (const entry of this.slides.values()) alignShortContentBody(entry.element)
    })
    return this.ready
  }

  get model(): Deck | null {
    return this.deck
  }

  /** Bind to a shared show; previews follow but never publish fragment counts. */
  follow(show: Presentation): void {
    this.unwatch()
    this.navigation = show
    this.following = true
    this.unwatch = show.watch(this.syncNavigation)
    if (!this.options.preview) this.publishSteps()
    this.syncNavigation()
  }

  /** Return to independent navigation without ending the shared show. */
  unfollow(): void {
    const show = new Presentation(this.deck?.slides.length ?? 0, this.index)
    this.follow(show)
    this.following = false
  }

  suspendMedia(suspended: boolean): void {
    this.mediaSuspended = suspended
    for (const entry of this.slides.values()) {
      if (suspended) this.pause(entry)
      else if (!entry.element.hidden) void this.activate(entry)
    }
  }

  go(action: Navigation): Promise<void> {
    if (!this.deck || this.closed) return Promise.resolve()
    this.navigation.go(action)
    return this.ready
  }

  private syncNavigation = (): void => {
    if (!this.deck || this.closed || this.loading) return
    if (this.index !== this.navigation.index) {
      const old = this.slides.get(this.index)
      if (old) {
        this.pause(old)
        old.attempted = new WeakSet()
      }
      this.index = this.navigation.index
      this.ready = this.update()
    } else this.applySteps()
  }

  private fragments(entry: RenderedSlide): HTMLElement[] {
    const slide = this.deck?.slides[entry.index]
    const steps = slide?.settings.attributes.steps
    if (steps !== true && steps !== 'true') return []
    return Array.from(
      entry.element.querySelectorAll<HTMLElement>('.abele-slide-content li')
    ).filter((item) => !item.parentElement?.closest('li'))
  }

  private publishSteps(): void {
    if (this.options.preview) return
    for (const [index, entry] of this.slides) {
      this.navigation.setSteps(index, this.fragments(entry).length)
    }
  }

  private applySteps(): void {
    for (const [index, entry] of this.slides) {
      this.fragments(entry).forEach((item, step) => {
        const visible =
          this.options.revealAll || (index === this.index && step < this.navigation.step)
        item.classList.add('abele-slide-fragment')
        item.classList.toggle('abele-slide-fragment-hidden', !visible)
        item.setAttribute('aria-hidden', String(!visible))
        item.inert = !visible
      })
    }
    this.previous.disabled = this.index === 0 && this.navigation.step === 0
    this.next.disabled =
      this.index >= (this.deck?.slides.length ?? 0) - 1 &&
      this.navigation.step >= this.navigation.stepCount
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
    this.applySteps()
    this.scale()
    return Promise.all(wanted.map((i) => this.slides.get(i)!.ready)).then(() => {
      if (this.closed) return
      const active = this.slides.get(this.index)
      if (active) {
        alignShortContentBody(active.element)
        return this.activate(active)
      }
    })
  }

  private mount(slide: Slide, index: number): RenderedSlide {
    const doc = this.root.ownerDocument
    const element = doc.createElement('section')
    element.className = `abele-slide abele-slide-${slide.settings.layout}`
    for (const name of slide.settings.className.split(/\s+/).filter(Boolean))
      element.classList.add(name)
    element.dataset.slide = String(index + 1 + (this.options.slideOffset ?? 0))
    if (slide.generated) element.dataset.generated = slide.generated
    const transition =
      slide.settings.attributes.transition ?? this.deck?.settings.properties.transition
    if (transition === 'fade' || transition === 'slide') element.dataset.transition = transition
    if (slide.settings.layout === 'grid') {
      const cells = slide.regions.filter((r) => r.name === 'cell').length
      element.style.setProperty(
        '--deck-columns',
        String(Math.max(1, cells <= 3 ? cells : Math.ceil(Math.sqrt(cells))))
      )
    }
    element.hidden = index !== this.index
    const background = this.media.resolve(slide.settings.bg)
    if (slide.settings.bg && !background) element.dataset.missingBackground = slide.settings.bg
    if (background) {
      const el = background.video ? doc.createElement('video') : doc.createElement('img')
      el.className = 'abele-slide-background'
      el.src = background.url
      el.style.objectFit = slide.settings.fit
      // The tag is known from construction; never compare a popout's node to a main-window class.
      if ('controls' in el) {
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
    if (slide.sources?.length) {
      element.classList.add('abele-slide-has-sources')
      const marker = doc.createElement('div')
      marker.className = 'abele-slide-sources-marker'
      marker.textContent = `Sources: ${slide.sources.length}`
      element.append(marker)
    }
    const observer = new MutationObserver(() => {
      if (entry.gone) return
      this.publishSteps()
      this.applySteps()
      alignShortContentBody(element)
      if (!element.hidden) void this.activate(entry)
      else this.pause(entry)
    })
    const entry: RenderedSlide = {
      index,
      element,
      cleanups: [],
      gone: false,
      ready: Promise.resolve(),
      observer,
      attempted: new WeakSet(),
      live: [],
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
            if (block.type !== 'markdown') {
              entry.live.push(this.liveBlock(block, el, entry))
              continue
            }
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
        if (
          slide.settings.layout === 'content' &&
          !slide.generated &&
          slide.regions.every((r) => r.blocks.every((b) => b.type === 'markdown'))
        ) {
          const body = prepareContentBody(element)
          if (body) {
            const resize = new ResizeObserver(() => alignShortContentBody(element))
            resize.observe(body)
            for (const block of Array.from(body.children)) resize.observe(block)
            entry.cleanups.push(() => resize.disconnect())
            alignShortContentBody(element)
          }
        }
        this.publishSteps()
        this.applySteps()
        if (!element.hidden) void this.activate(entry)
        else this.pause(entry)
      }
    })
    return entry
  }

  private async activate(entry: RenderedSlide): Promise<void> {
    if (this.options.preview || this.mediaSuspended) {
      this.pause(entry)
      return
    }
    await Promise.all(entry.live.map((live) => live.start()))
    if (entry.gone || entry.element.hidden || this.closed || this.mediaSuspended) return
    const index = entry.index
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
    entry.live.forEach((live) => live.stop())
    for (const video of Array.from(entry.element.querySelectorAll('video'))) {
      video.autoplay = false
      video.pause()
    }
    for (const audio of Array.from(entry.element.querySelectorAll('audio'))) audio.pause()
  }

  private liveBlock(block: ScriptBlock | HtmlBlock, target: HTMLElement, entry: RenderedSlide) {
    let controller: AbortController | null = null
    let cleanup: (() => void) | null = null
    let timer: number | null = null
    let frame: HTMLIFrameElement | null = null
    let label: HTMLElement | null = null
    let started = false
    let once = false
    let activation = 0
    const stop = () => {
      ++activation
      // Static results remain a snapshot. A disposed view must be rebuilt to work again.
      if ((cleanup as ((() => void) & { interactive?: boolean }) | null)?.interactive) once = false
      controller?.abort()
      controller = null
      cleanup?.()
      cleanup = null
      if (timer !== null) target.ownerDocument.defaultView?.clearInterval(timer)
      timer = null
      frame?.remove()
      frame = null
      label?.remove()
      label = null
      if (block.type === 'script' && (block.refresh !== 'once' || !once)) target.replaceChildren()
      started = false
    }
    const start = async () => {
      if (
        started ||
        entry.gone ||
        entry.element.hidden ||
        this.closed ||
        this.mediaSuspended ||
        this.options.preview
      )
        return
      if (block.type === 'script' && block.refresh === 'once' && once) return
      started = true
      const token = ++activation
      const current = () =>
        token === activation &&
        started &&
        !entry.gone &&
        !entry.element.hidden &&
        !this.closed &&
        !this.mediaSuspended
      if (block.type === 'html') {
        // The opaque-origin frame is recreated on every entry; removing it kills its timers and audio.
        const network = (await this.renderer.allowNetwork?.(this.deck!)) ?? false
        if (!current()) return
        frame = target.ownerDocument.createElement('iframe')
        frame.setAttribute('sandbox', network ? 'allow-scripts' : '')
        frame.setAttribute('title', 'Slide HTML')
        const policy = network
          ? "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: https:; media-src data: https:; connect-src https:; font-src data: https:; navigate-to https:; form-action 'none'; base-uri 'none'"
          : "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"
        const html = network ? block.source : staticHtml(block.source, target.ownerDocument)
        if (!network) {
          label = target.ownerDocument.createElement('p')
          label.textContent = 'Offline HTML — static only; scripts disabled'
          target.append(label)
        }
        frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="${policy}">${html}`
        target.append(frame)
        return
      }
      const run = async () => {
        if (!current()) return
        cleanup?.()
        cleanup = null
        controller?.abort()
        controller = new AbortController()
        const signal = controller.signal
        target.replaceChildren()
        try {
          const dispose = await this.renderer.script?.(block, target, signal)
          if (signal.aborted || !current()) dispose?.()
          else cleanup = dispose ?? null
        } catch (error) {
          if (!signal.aborted && current())
            target.textContent = `Script could not be run: ${error instanceof Error ? error.message : error}`
        }
      }
      await run()
      if (!current()) return
      once = true
      if (typeof block.refresh === 'number')
        timer =
          target.ownerDocument.defaultView?.setInterval(() => {
            void run()
          }, block.refresh) ?? null
    }
    return { start, stop }
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
    if (this.closed || (this.placeholder && (!fullscreen || this.fullscreenOwned))) return
    const doc = this.root.ownerDocument
    if (!this.placeholder) {
      this.focusBefore = doc.activeElement as HTMLElement | null
      this.placeholder = doc.createComment('presentation tab')
      this.root.before(this.placeholder)
      doc.body.append(this.root)
      this.root.classList.add('abele-deck-presenting')
      this.hideControls()
      void this.options.presentationHost?.enter()
      this.play.textContent = 'Exit'
      this.play.setAttribute('aria-label', 'Exit presentation')
      this.scale()
    }
    this.root.focus()
    const host = this.options.fullscreenHost
    if (fullscreen && (host || this.root.requestFullscreen)) {
      try {
        if (host) await host.enter()
        else await this.root.requestFullscreen()
        if (this.closed || !this.placeholder) {
          if (host) await host.exit()
          else if (doc.fullscreenElement === this.root) await doc.exitFullscreen()
        } else {
          this.fullscreenOwned = true
          this.root.classList.add('abele-deck-fullscreen')
        }
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
    this.root.classList.remove('abele-deck-presenting', 'abele-deck-fullscreen')
    this.clearControlsTimer()
    this.overControls = false
    this.root.classList.remove('abele-deck-controls-visible')
    this.toolbar.inert = false
    this.toolbar.removeAttribute('aria-hidden')
    void this.options.presentationHost?.exit()
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
    this.options.onExit?.()
  }

  private clearControlsTimer(): void {
    this.root.ownerDocument.defaultView?.clearTimeout(this.controlsTimer)
    this.controlsTimer = undefined
  }

  private hideControls(): void {
    this.clearControlsTimer()
    this.root.classList.remove('abele-deck-controls-visible')
    this.toolbar.inert = true
    this.toolbar.setAttribute('aria-hidden', 'true')
  }

  private scheduleControlsHide(): void {
    this.clearControlsTimer()
    if (!this.placeholder) return
    this.controlsTimer = this.root.ownerDocument.defaultView?.setTimeout(() => {
      this.controlsTimer = undefined
      if (!this.overControls && !this.toolbar.contains(this.root.ownerDocument.activeElement))
        this.hideControls()
    }, 2500)
  }

  private showControls(): void {
    if (!this.placeholder) return
    this.root.classList.add('abele-deck-controls-visible')
    this.toolbar.inert = false
    this.toolbar.setAttribute('aria-hidden', 'false')
    this.scheduleControlsHide()
  }

  /** Only the top strip reveals desktop controls; moving over the slide does not disturb it. */
  private onPointerMove = (event: PointerEvent): void => {
    if (!this.placeholder || event.pointerType !== 'mouse') return
    const box = this.root.getBoundingClientRect()
    const top = event.clientY - box.top
    const wasOver = this.overControls
    this.overControls = (top >= 0 && top <= 48) || this.toolbar.contains(event.target as Node)
    if (this.overControls) this.showControls()
    else if (wasOver) this.scheduleControlsHide()
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
    if (event.key === 'Tab' && this.placeholder) this.showControls()
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
      time: performance.now(),
    }
  }
  private onPointerUp = (event: PointerEvent): void => {
    const gesture = this.gesture
    this.gesture = null
    if (!gesture || gesture.id !== event.pointerId || interactive(event.target)) return
    const box = this.viewport.getBoundingClientRect()
    if (
      performance.now() - gesture.time >= 600 &&
      Math.hypot(
        event.clientX - box.left - gesture.start.x,
        event.clientY - box.top - gesture.start.y
      ) < 10 &&
      this.options.onNotes
    ) {
      event.preventDefault()
      this.options.onNotes()
      return
    }
    this.showControls()
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
    this.unwatch()
    this.resize.disconnect()
    for (const entry of this.slides.values()) this.release(entry)
    this.slides.clear()
    this.root.remove()
  }
}
