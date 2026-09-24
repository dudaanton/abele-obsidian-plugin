/**
 * A tab showing one book from the vault.
 *
 * The book is drawn by foliate-js, one chapter per sandboxed frame; everything that keeps the
 * book's own code from running is in `bookSafety.ts`, and this view adds the last check — every
 * page is audited as it arrives, and one that fails is emptied before it is shown.
 */
import { FileView, Platform, type TFile, type WorkspaceLeaf } from 'obsidian'
import { frameOptions } from '@/vendor/foliate-js/frame-options.js'
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import { auditDocument, blankDocument, frameSandbox, isOpenableExternal } from './bookSafety'
import { openEpub, type OpenedBook } from './openBook'

export const BOOK_VIEW_TYPE = 'abele-book'
export const BOOK_EXTENSIONS = ['epub']

/**
 * For the e2e tier only: a sandbox to use instead of the platform's, so the desktop app can be
 * made to draw pages the way the iPhone does and prove the policy holds without the sandbox.
 */
export const readerTestHooks: { sandbox: string | null } = { sandbox: null }

/** What a page frame reported, kept for the e2e tier and the diagnostics of a blanked page. */
export interface PageReport {
  index: number
  findings: string[]
  sandbox: string | null
}

/** The colours and font of the current theme, as literal values a page frame can use. */
function themeCss(el: HTMLElement): string {
  const style = getComputedStyle(el)
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return `
    html { color: ${v('--text-normal', 'CanvasText')}; background: transparent !important; }
    body { background: transparent !important; }
    a:any-link { color: ${v('--text-accent', 'LinkText')}; }
    ::selection { background: ${v('--text-selection', 'Highlight')}; }
  `
}

export class BookView extends FileView {
  allowNoFile = false
  private reader: FoliateView | null = null
  private opened: OpenedBook | null = null
  private loadToken = 0
  /** Every page loaded so far in this tab, newest last. */
  readonly pages: PageReport[] = []

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.navigation = true
  }

  getViewType(): string {
    return BOOK_VIEW_TYPE
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'Book'
  }

  getIcon(): string {
    return 'book-open'
  }

  canAcceptExtension(extension: string): boolean {
    return BOOK_EXTENSIONS.includes(extension)
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file)
    await this.show(file)
  }

  async onUnloadFile(file: TFile): Promise<void> {
    this.teardown()
    await super.onUnloadFile(file)
  }

  async onClose(): Promise<void> {
    this.teardown()
    await super.onClose()
  }

  /** The engine element, once a book is open: the e2e tier and later phases reach it here. */
  get engine(): FoliateView | null {
    return this.reader
  }

  private teardown(): void {
    this.loadToken++
    this.reader?.close()
    this.reader?.remove()
    this.reader = null
    this.opened?.destroy()
    this.opened = null
    this.pages.length = 0
    this.contentEl.empty()
  }

  private showMessage(text: string): void {
    this.contentEl.empty()
    this.contentEl.createDiv({ cls: 'abele-book__message', text })
  }

  private async show(file: TFile): Promise<void> {
    this.teardown()
    const token = this.loadToken
    this.contentEl.addClass('abele-book')
    this.showMessage('Opening the book…')
    try {
      const data = new Uint8Array(await this.app.vault.readBinary(file))
      if (token !== this.loadToken) return
      const opened = await openEpub(data)
      if (token !== this.loadToken) {
        opened.destroy()
        return
      }
      await import('@/vendor/foliate-js/view.js')
      frameOptions.sandbox = readerTestHooks.sandbox ?? frameSandbox(Platform)
      this.contentEl.empty()
      const reader = this.contentEl.createEl('foliate-view', { cls: 'abele-book__engine' })
      // A custom element is defined per window: in a pop-out window the tag stays a plain element.
      if (typeof reader.open !== 'function') {
        opened.destroy()
        this.showMessage('Books open in the main window only.')
        return
      }
      reader.addEventListener('load', (e) => this.onPage((e as CustomEvent).detail))
      reader.addEventListener('external-link', (e) => this.onExternalLink(e as CustomEvent))
      this.reader = reader
      this.opened = opened
      await reader.open(opened.book)
      if (token !== this.loadToken) return
      const renderer = reader.renderer as unknown as { setStyles?: (css: string) => void }
      renderer.setStyles?.(themeCss(this.contentEl))
      await reader.init({ showTextStart: true })
    } catch (e) {
      if (token !== this.loadToken) return
      console.error('[Abele] book did not open', e)
      this.teardown()
      this.showMessage(`This book could not be opened. ${(e as Error).message ?? ''}`.trim())
    }
  }

  /** Every page, as it arrives in its frame: audited, and wired for keys and taps. */
  private onPage({ doc, index }: { doc: Document; index: number }): void {
    const frame = doc.defaultView?.frameElement ?? null
    const findings = auditDocument(doc)
    this.pages.push({ index, findings, sandbox: frame?.getAttribute('sandbox') ?? null })
    if (findings.length) {
      console.warn('[Abele] a book page failed its check and was emptied', findings)
      blankDocument(doc)
      return
    }
    // Links the engine does not handle — SVG links, image maps — go nowhere.
    doc.addEventListener('click', (e) => {
      const target = e.target as Element | null
      const link = target?.closest?.('a, area')
      if (link && !(link.localName === 'a' && link.hasAttribute('href'))) e.preventDefault()
    })
    doc.addEventListener('keydown', (e) => this.onKey(e))
    doc.addEventListener('click', (e) => this.onTap(e, doc))
  }

  private onExternalLink(e: CustomEvent<{ href_?: string }>): void {
    e.preventDefault()
    const href = e.detail?.href_ ?? ''
    if (isOpenableExternal(href)) window.open(href, '_blank')
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.reader) return
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault()
      void this.reader.goLeft()
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault()
      void this.reader.goRight()
    }
  }

  /** A tap near the left or right edge turns the page; anywhere else it is left to the page. */
  private onTap(e: MouseEvent, doc: Document): void {
    if (!this.reader || e.defaultPrevented) return
    if ((e.target as Element | null)?.closest?.('a, area')) return
    if (!doc.getSelection()?.isCollapsed) return
    const width = this.contentEl.clientWidth
    if (!width) return
    const frame = doc.defaultView?.frameElement
    const x =
      e.clientX +
      (frame?.getBoundingClientRect().left ?? 0) -
      this.contentEl.getBoundingClientRect().left
    if (x < width * 0.25) void this.reader.goLeft()
    else if (x > width * 0.75) void this.reader.goRight()
  }

  onload(): void {
    super.onload()
    this.registerDomEvent(this.contentEl, 'keydown', (e) => this.onKey(e))
  }
}

/** Every open book tab, for tests and later the agent. */
export function bookViews(app: {
  workspace: { getLeavesOfType(type: string): WorkspaceLeaf[] }
}): BookView[] {
  return app.workspace
    .getLeavesOfType(BOOK_VIEW_TYPE)
    .map((leaf) => leaf.view)
    .filter((view): view is BookView => view instanceof BookView)
}
