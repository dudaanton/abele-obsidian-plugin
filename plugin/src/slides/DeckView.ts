import {
  FileView,
  Notice,
  Platform,
  Scope,
  type TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { DeckViewer } from './core/DeckViewer'
import { DeckFollower } from './core/DeckFollower'
import { parseDeck } from './core/markdown'
import { noteDeckSource, noteMedia, noteRenderer } from './adapter'
import { liveRenderer } from './liveAdapter'
import { DECK_VIEW_TYPE, sourceLeaves } from './opening'
import { desktopFullscreen } from './fullscreen'
import { Presentation } from './core/Presentation'
import { PresenterView } from './core/PresenterView'
import type { Deck } from './core/model'

// Runtime-only bootstraps: a new audience leaf must not activate slide zero during file loading.
const audienceBootstraps = new WeakSet<WorkspaceLeaf>()

/** Read-only file adapter: only the source editor writes, never the viewer's preview buffer. */
export class DeckView extends FileView {
  viewer: DeckViewer | null = null
  presenter: PresenterView | null = null
  show: Presentation | null = null
  private audience: DeckView | null = null
  private starting: Promise<void> | null = null
  private readonly follower: DeckFollower
  private updateTimer = 0
  private lastSource: string | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.scope = new Scope(this.app.scope)
    // Let the viewer receive its own keys instead of the app's arrow/space shortcuts.
    for (const key of [
      'ArrowRight',
      'ArrowLeft',
      'ArrowDown',
      'ArrowUp',
      'PageDown',
      'PageUp',
      'Home',
      'End',
      ' ',
      'Escape',
    ])
      this.scope.register([], key, (event) => {
        if (this.presenter) this.presenter.handleKey(event)
        else this.viewer?.handleKey(event)
        return event.defaultPrevented ? false : undefined
      })
    this.follower = new DeckFollower(
      noteDeckSource(this.app, () => this.file),
      (deck) => {
        this.lastSource = null
        this.applyDeck(deck)
      }
    )
    this.register(() => this.follower.stop())
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor, view) => {
        if (!this.file || view.file?.path !== this.file.path) return
        this.follower.invalidate()
        window.clearTimeout(this.updateTimer)
        this.updateTimer = window.setTimeout(() => this.preview(editor.getValue()), 120)
      })
    )
    this.register(() => window.clearTimeout(this.updateTimer))
  }

  getViewType(): string {
    return DECK_VIEW_TYPE
  }
  getDisplayText(): string {
    return this.file?.basename ?? 'Presentation'
  }
  getIcon(): string {
    return 'presentation'
  }
  canAcceptExtension(extension: string): boolean {
    return extension === 'md'
  }

  private clear(): void {
    this.show?.end()
    this.follower.invalidate()
    window.clearTimeout(this.updateTimer)
    this.viewer?.destroy()
    this.viewer = null
    this.lastSource = null
  }

  async onOpen(): Promise<void> {
    this.ensureViewer()
  }
  async onClose(): Promise<void> {
    this.follower.stop()
    this.clear()
    await super.onClose()
  }
  async onLoadFile(file: TFile): Promise<void> {
    this.file = file
    this.ensureViewer()
    await this.follower.refresh()
    await this.viewer?.ready
  }
  async onUnloadFile(file: TFile): Promise<void> {
    this.clear()
    await super.onUnloadFile(file)
  }

  private preview(data: string): void {
    if (!this.viewer || data === this.lastSource) return
    this.follower.replace(parseDeck(data))
    this.lastSource = data
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), slide: this.viewer?.index ?? 0 }
  }
  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    await super.setState(state, result)
    if (typeof state.slide === 'number') await this.viewer?.go(state.slide)
  }

  private ensureViewer(): void {
    if (this.viewer) return
    this.contentEl.classList.add('abele-deck-tab')
    this.viewer = new DeckViewer(
      this.contentEl,
      liveRenderer(
        this.app,
        () => this.file?.path ?? '',
        noteRenderer(this.app, () => this.file?.path ?? '')
      ),
      noteMedia(this.app, () => this.file?.path ?? ''),
      {
        fullscreen: !Platform.isMobile,
        fullscreenHost: desktopFullscreen(this.contentEl),
        onExit: () => this.show?.end(),
        onNotes: () => {
          if (Platform.isMobile) void this.startPresenter()
        },
      }
    )
    if (audienceBootstraps.has(this.leaf)) this.viewer.suspendMedia(true)
    this.viewer
      .button('Present', () => void this.startPresenter())
      .classList.add('abele-deck-presenter-action')
    this.viewer
      .button('Edit source', () => void this.edit(false))
      .classList.add('abele-deck-editor-action')
    this.viewer
      .button('Edit beside', () => void this.edit(true))
      .classList.add('abele-deck-editor-action')
  }

  private applyDeck(deck: Deck): void {
    void this.viewer?.setDeck(deck)
    void this.presenter?.setDeck(deck)
    if (this.presenter) this.audience?.follower.replace(deck)
  }

  /** Desktop uses an app-owned popout; mobile keeps a local full-window presenter. */
  startPresenter(): Promise<void> {
    if (this.starting !== null) return this.starting
    if (this.show || !this.viewer?.model || !this.file) {
      this.presenter?.root.focus()
      return Promise.resolve()
    }
    const pending = this.openPresenter()
    this.starting = pending
    void pending.finally(() => {
      if (this.starting === pending) this.starting = null
    })
    return pending
  }

  private async openPresenter(): Promise<void> {
    const viewer = this.viewer
    const deck = viewer.model
    const file = this.file
    viewer.exitPresenting()
    const show = new Presentation(deck.slides.length, viewer.index)
    this.show = show
    viewer.follow(show)
    viewer.suspendMedia(true)
    viewer.root.hidden = true
    this.presenter = new PresenterView(
      this.contentEl,
      show,
      liveRenderer(
        this.app,
        () => this.file?.path ?? '',
        noteRenderer(this.app, () => this.file?.path ?? '')
      ),
      noteMedia(this.app, () => this.file?.path ?? ''),
      Platform.isMobile
    )
    let popout: WorkspaceLeaf | null = null
    const doc = this.contentEl.ownerDocument
    const end = () => show.end()
    doc.defaultView?.addEventListener('beforeunload', end)
    show.onEnd(() => {
      doc.defaultView?.removeEventListener('beforeunload', end)
      this.show = null
      this.presenter?.destroy()
      this.presenter = null
      this.audience = null
      viewer.unfollow()
      viewer.root.hidden = false
      viewer.suspendMedia(false)
      popout?.detach()
      viewer.root.focus()
    })
    try {
      await this.presenter.setDeck(deck)
      if (show.ended || Platform.isMobile) return
      popout = this.app.workspace.openPopoutLeaf()
      audienceBootstraps.add(popout)
      try {
        await popout.setViewState({
          type: DECK_VIEW_TYPE,
          state: { file: file.path },
          active: true,
        })
      } finally {
        audienceBootstraps.delete(popout)
      }
      if (show.ended) {
        popout.detach()
        return
      }
      const audience = popout.view
      if (!(audience instanceof DeckView) || !audience.viewer)
        throw new Error('Audience view could not be opened')
      this.audience = audience
      audience.show = show
      audience.viewer.follow(show)
      audience.viewer.root.classList.add('abele-deck-audience')
      audience.viewer.button('Fullscreen', () => void audience.viewer?.present(true))
      const audienceDoc = audience.contentEl.ownerDocument
      audienceDoc.defaultView?.addEventListener('beforeunload', end)
      show.onEnd(() => {
        audienceDoc.defaultView?.removeEventListener('beforeunload', end)
        audience.show = null
        audience.viewer?.exitPresenting()
      })
      await audience.viewer.setDeck(deck)
      if (show.ended) return
      audience.viewer.suspendMedia(false)
      await audience.viewer.present(false)
      if (!show.ended) {
        this.app.workspace.setActiveLeaf(this.leaf, { focus: true })
        this.presenter?.root.focus()
      }
    } catch (error) {
      show.end()
      new Notice(
        `Presentation could not be started: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  private async edit(beside: boolean): Promise<void> {
    if (!this.file) return
    const target = beside ? this.app.workspace.createLeafBySplit(this.leaf, 'vertical') : this.leaf
    sourceLeaves.add(target)
    await target.setViewState({
      type: 'markdown',
      state: { file: this.file.path, mode: 'source' },
      active: true,
    })
  }
}
