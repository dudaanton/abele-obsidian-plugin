import { DeckViewer, interactive } from './DeckViewer'
import type { BlockRenderer, Deck, MediaResolver } from './model'
import { slideForKey } from './navigation'
import { Presentation } from './Presentation'

/** Local presenter UI. Window creation and source tracking belong to the app adapter. */
export class PresenterView {
  readonly root: HTMLElement
  readonly current: DeckViewer
  readonly next: DeckViewer
  readonly notes: HTMLElement
  ready: Promise<void> = Promise.resolve()
  private readonly timer: HTMLElement
  private readonly pause: HTMLButtonElement
  private readonly list: HTMLSelectElement
  private readonly abort = new AbortController()
  private readonly interval: number
  private readonly unwatch: () => void
  private readonly unend: () => void
  private deck: Deck | null = null
  private noteIndex = -1
  private revision = 0
  private cleanups: (() => void)[] = []
  private closed = false

  constructor(
    host: HTMLElement,
    readonly show: Presentation,
    private readonly renderer: BlockRenderer,
    media: MediaResolver,
    overlay = false
  ) {
    const doc = host.ownerDocument
    this.root = doc.createElement('div')
    this.root.className = `abele-presenter${overlay ? ' abele-deck-presenting' : ''}`
    this.root.tabIndex = 0
    this.root.setAttribute('aria-label', 'Presenter view')
    const toolbar = doc.createElement('div')
    toolbar.className = 'abele-deck-toolbar'
    const button = (label: string, action: () => void) => {
      const el = doc.createElement('button')
      el.type = 'button'
      el.textContent = label
      el.addEventListener(
        'click',
        () => {
          action()
          this.root.focus()
        },
        { signal: this.abort.signal }
      )
      toolbar.append(el)
      return el
    }
    button('Previous', () => show.go('previous'))
    button('Next', () => show.go('next'))
    this.timer = doc.createElement('span')
    this.timer.className = 'abele-presenter-timer'
    this.timer.setAttribute('aria-label', 'Elapsed time')
    toolbar.append(this.timer)
    this.pause = button('Pause timer', () => show.toggleTimer())
    button('Reset timer', () => show.resetTimer())
    button('End show', () => show.end())
    this.list = doc.createElement('select')
    this.list.setAttribute('aria-label', 'Choose slide')
    this.list.className = 'abele-presenter-list'
    this.list.addEventListener(
      'change',
      () => {
        show.go(Number(this.list.value))
        this.root.focus()
      },
      { signal: this.abort.signal }
    )
    toolbar.append(this.list)
    const previews = doc.createElement('div')
    previews.className = 'abele-presenter-previews'
    const preview = (label: string) => {
      const section = doc.createElement('div')
      section.className = 'abele-presenter-preview'
      const heading = doc.createElement('div')
      heading.className = 'abele-presenter-label'
      heading.textContent = label
      const container = doc.createElement('div')
      container.className = 'abele-presenter-canvas'
      section.append(heading, container)
      previews.append(section)
      return container
    }
    this.current = new DeckViewer(preview('Current slide'), renderer, media, { preview: true })
    this.current.follow(show)
    this.next = new DeckViewer(preview('Next slide'), renderer, media, {
      preview: true,
      revealAll: true,
    })
    this.notes = doc.createElement('div')
    this.notes.className = 'abele-presenter-notes markdown-rendered'
    this.notes.setAttribute('aria-label', 'Speaker notes')
    this.root.append(toolbar, previews, this.notes)
    ;(overlay ? doc.body : host).append(this.root)
    this.root.addEventListener('keydown', this.handleKey, {
      signal: this.abort.signal,
      capture: true,
    })
    if (overlay)
      doc.addEventListener('keydown', this.handleKey, { signal: this.abort.signal, capture: true })
    this.unwatch = show.watch(this.update)
    this.unend = show.onEnd(() => this.destroy())
    this.interval = doc.defaultView!.setInterval(() => this.updateTimer(), 250)
    this.updateTimer()
    this.root.focus()
  }

  async setDeck(deck: Deck): Promise<void> {
    if (this.closed) return
    this.deck = deck
    this.noteIndex = -1
    this.list.replaceChildren(
      ...deck.slides.map((slide, index) => {
        const option = this.root.ownerDocument.createElement('option')
        option.value = String(index)
        option.textContent = `${index + 1}. ${slide.title || 'Untitled slide'}`
        return option
      })
    )
    const previews = Promise.all([this.current.setDeck(deck), this.next.setDeck(deck)])
    this.update()
    const notes = this.ready
    this.ready = Promise.all([previews, notes]).then(() => {})
    await this.ready
  }

  private update = (): void => {
    if (this.closed || !this.deck) return
    this.updateTimer()
    this.list.value = String(this.show.index)
    this.next.root.hidden = this.show.index >= this.deck.slides.length - 1
    const next = this.next.go(Math.min(this.show.index + 1, this.deck.slides.length - 1))
    if (this.noteIndex !== this.show.index) {
      this.noteIndex = this.show.index
      this.ready = Promise.all([next, this.current.ready, this.renderNotes()]).then(() => {})
    }
  }

  private updateTimer(): void {
    const seconds = Math.floor(this.show.elapsed / 1000)
    this.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    this.pause.textContent = this.show.running ? 'Pause timer' : 'Resume timer'
  }

  private async renderNotes(): Promise<void> {
    const revision = ++this.revision
    this.cleanups.splice(0).forEach((cleanup) => cleanup())
    this.notes.replaceChildren()
    const blocks = this.deck?.slides[this.show.index]?.notes ?? []
    if (!blocks.length) this.notes.textContent = 'No speaker notes'
    for (const block of blocks) {
      if (this.closed || revision !== this.revision) break
      const el = this.root.ownerDocument.createElement('div')
      this.notes.append(el)
      try {
        const cleanup = await this.renderer.render(block, el)
        if (this.closed || revision !== this.revision) cleanup()
        else this.cleanups.push(cleanup)
      } catch (error) {
        if (!this.closed && revision === this.revision)
          el.textContent = `Notes could not be rendered: ${error instanceof Error ? error.message : error}`
      }
    }
  }

  handleKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.show.end()
      return
    }
    if (interactive(event.target)) return
    const action = slideForKey(event.key)
    if (action === null) return
    event.preventDefault()
    event.stopPropagation()
    this.show.go(action)
  }

  destroy(): void {
    if (this.closed) return
    this.closed = true
    this.revision++
    this.abort.abort()
    this.unwatch?.()
    this.unend?.()
    this.root.ownerDocument.defaultView!.clearInterval(this.interval)
    this.cleanups.splice(0).forEach((cleanup) => cleanup())
    this.current.destroy()
    this.next.destroy()
    this.root.remove()
  }
}
