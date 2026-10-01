import {
  FileView,
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
import { DECK_VIEW_TYPE, sourceLeaves } from './opening'
import { desktopFullscreen } from './fullscreen'

/** Read-only file adapter: only the source editor writes, never the viewer's preview buffer. */
export class DeckView extends FileView {
  viewer: DeckViewer | null = null
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
        this.viewer?.handleKey(event)
        return event.defaultPrevented ? false : undefined
      })
    this.follower = new DeckFollower(
      noteDeckSource(this.app, () => this.file),
      (deck) => {
        this.lastSource = null
        void this.viewer?.setDeck(deck)
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
      noteRenderer(this.app, () => this.file?.path ?? ''),
      noteMedia(this.app, () => this.file?.path ?? ''),
      { fullscreen: !Platform.isMobile, fullscreenHost: desktopFullscreen(this.contentEl) }
    )
    this.viewer
      .button('Edit source', () => void this.edit(false))
      .classList.add('abele-deck-editor-action')
    this.viewer
      .button('Edit beside', () => void this.edit(true))
      .classList.add('abele-deck-editor-action')
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
