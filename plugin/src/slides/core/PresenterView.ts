import { t } from '@/i18n'
import { DeckViewer, interactive } from './DeckViewer'
import type { BlockRenderer, Deck, MediaResolver } from './model'
import { slideForKey } from './navigation'
import { Presentation } from './Presentation'
import { presentationDeck } from './sources'

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
    this.root.setAttribute('aria-label', t('streamC.ad53f79d6a64d94d'))
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
    button(t('streamC.a57b08a480b822a0'), () => show.go('previous'))
    button(t('streamC.1ff57a29d7c9d11b'), () => show.go('next'))
    this.timer = doc.createElement('span')
    this.timer.className = 'abele-presenter-timer'
    this.timer.setAttribute('aria-label', t('streamC.4bbe728339ef4a3d'))
    toolbar.append(this.timer)
    this.pause = button(t('streamC.1f84100edfdf1589'), () => show.toggleTimer())
    button(t('streamC.23d712d2c6eda4e0'), () => show.resetTimer())
    button(t('streamC.2fa38fa11f3bf17a'), () => show.end())
    this.list = doc.createElement('select')
    this.list.setAttribute('aria-label', t('streamC.0774a403a9b3f62c'))
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
    this.current = new DeckViewer(preview(t('streamC.8d62407a88b6f379')), renderer, media, {
      preview: true,
    })
    this.current.follow(show)
    this.next = new DeckViewer(preview(t('streamC.cdc93d1c8fe9a2af')), renderer, media, {
      preview: true,
      revealAll: true,
    })
    this.notes = doc.createElement('div')
    this.notes.className = 'abele-presenter-notes markdown-rendered'
    this.notes.setAttribute('aria-label', t('streamC.29e0947258ccee2a'))
    this.root.append(toolbar, previews, this.notes)
    ;(overlay ? doc.body : host).append(this.root)
    this.root.addEventListener('keydown', this.handleKey, {
      signal: this.abort.signal,
      capture: true,
    })
    if (overlay)
      doc.addEventListener('keydown', this.handleKey, { signal: this.abort.signal, capture: true })
    this.interval = doc.defaultView!.setInterval(() => this.updateTimer(), 250)
    this.updateTimer()
    this.unwatch = show.watch(this.update)
    this.unend = show.onEnd(() => this.destroy())
    this.root.focus()
  }

  async setDeck(deck: Deck): Promise<void> {
    if (this.closed) return
    deck = presentationDeck(deck)
    this.deck = deck
    this.noteIndex = -1
    this.list.replaceChildren(
      ...deck.slides.map((slide, index) => {
        const option = this.root.ownerDocument.createElement('option')
        option.value = String(index)
        option.textContent = `${index + 1}. ${slide.title || t('streamC.1eadae5cbf6429d2')}`
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
    this.pause.textContent = this.show.running
      ? t('streamC.1f84100edfdf1589')
      : t('streamC.e387be69fcbae143')
  }

  private async renderNotes(): Promise<void> {
    const revision = ++this.revision
    this.cleanups.splice(0).forEach((cleanup) => cleanup())
    this.notes.replaceChildren()
    const blocks = this.deck?.slides[this.show.index]?.notes ?? []
    if (!blocks.length) this.notes.textContent = t('streamC.0afc1d567f62dc10')
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
          el.textContent = t('streamC.24d82bf63f1d76f3', {
            v1: String(error instanceof Error ? error.message : error),
          })
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
