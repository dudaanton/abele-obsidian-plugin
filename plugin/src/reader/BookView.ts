/**
 * A tab showing one book from the vault.
 *
 * The book is drawn by foliate-js, one chapter per sandboxed frame; everything that keeps the
 * book's own code from running is in `bookSafety.ts`, and this view adds the last check — every
 * page is audited as it arrives, and one that fails is emptied before it is shown. Around the
 * page, a Vue side (`BookReader.vue`) shows the contents, the progress and the dialogs.
 */
import { FileView, Platform, loadPdfJs, type Menu, type TFile, type WorkspaceLeaf } from 'obsidian'
import { createApp, reactive, watch, type App as VueApp, type WatchStopHandle } from 'vue'
import { frameOptions } from '@/vendor/foliate-js/frame-options.js'
import type { FoliateLocation, View as FoliateView } from '@/vendor/foliate-js/view.js'
import { FootnoteHandler } from '@/vendor/foliate-js/footnotes.js'
import BookReader from '@/components/reader/BookReader.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { auditDocument, blankDocument, frameSandbox, isOpenableExternal } from './bookSafety'
import { openEpub, type OpenedBook } from './openBook'
import { emptyBookModel, tocEntries, type BookModel } from './model'
import {
  darkPdfPages,
  layoutAttributes,
  pageStyles,
  readerSettingsFrom,
  themeValues,
} from './settings'
import { openPdf } from './pdfBook'
import { swipeDirection } from './swipe'
import { bookKey } from './positions'
import { bookPlaces } from './places'

export const BOOK_VIEW_TYPE = 'abele-book'
/** What opens in a book tab by itself. */
export const BOOK_EXTENSIONS = ['epub']
/** What a book tab can show: PDFs too, when asked to (a menu item, or the setting). */
export const READER_EXTENSIONS = ['epub', 'pdf']

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

const PANEL_KEY = 'abele-book-panel'

export class BookView extends FileView {
  allowNoFile = false
  readonly model: BookModel = reactive(emptyBookModel())
  private reader: FoliateView | null = null
  private opened: OpenedBook | null = null
  private loadToken = 0
  private vue: VueApp | null = null
  private stage: HTMLElement | null = null
  private stageReady: Promise<HTMLElement>
  private resolveStage!: (el: HTMLElement) => void
  private stopWatch: WatchStopHandle | null = null
  private key = ''
  private footnotes = new FootnoteHandler()
  private footnoteHref = ''
  private openedTwoPages = false
  /** Every page loaded so far in this tab, newest last. */
  readonly pages: PageReport[] = []

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.navigation = true
    this.stageReady = new Promise((resolve) => (this.resolveStage = resolve))
    // The note's own engine goes into its dialog as soon as it exists: its page loads only once
    // it is in the document.
    this.footnotes.addEventListener('before-render', (e) => {
      const view = (e as CustomEvent<{ view: FoliateView }>).detail.view
      view.addClass('abele-book__engine')
      view.addEventListener('load', (ev) => this.onPage((ev as CustomEvent).detail, false))
      this.applyTo(view, true)
      this.model.footnote = { view, href: this.footnoteHref, type: null }
    })
    this.footnotes.addEventListener('render', (e) => {
      const { type } = (e as CustomEvent<{ type: string | null }>).detail
      if (this.model.footnote) this.model.footnote.type = type
    })
  }

  getViewType(): string {
    return BOOK_VIEW_TYPE
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'Book'
  }

  canAcceptExtension(extension: string): boolean {
    return READER_EXTENSIONS.includes(extension)
  }

  /** Whether the tab shows a PDF, whose pages are pictures of a fixed size. */
  get isPdf(): boolean {
    return this.file?.extension === 'pdf'
  }

  getIcon(): string {
    return this.isPdf ? 'file-text' : 'book-open'
  }

  /** The engine element, once a book is open: the e2e tier and later phases reach it here. */
  get engine(): FoliateView | null {
    return this.reader
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.addClass('abele-book')
    const mount = this.contentEl.createDiv({ cls: 'abele-book__mount' })
    this.model.panel = !Platform.isPhone && this.app.loadLocalStorage(PANEL_KEY) === '1'
    this.vue = createApp(BookReader, {
      model: this.model,
      onStage: (el: HTMLElement) => {
        this.stage = el
        this.resolveStage(el)
      },
      onGo: (href: string, fromPanel: boolean) => {
        if (fromPanel) this.model.panel = false
        void this.reader?.goTo(href)
      },
      onSeek: (fraction: number): void => void this.reader?.goToFraction(fraction),
      onBack: (): void => this.reader?.history.back(),
      onPanel: (open: boolean) => this.setPanel(open),
      onSettings: (open: boolean) => (this.model.settingsOpen = open),
      onFootnoteClose: () => this.closeFootnote(),
      onFootnoteGo: () => {
        const href = this.footnoteHref
        this.closeFootnote()
        if (href) void this.reader?.goTo(href)
      },
    })
    this.vue.mount(mount)

    this.addAction('list', 'Contents', () => this.setPanel(!this.model.panel))
    this.addAction('a-large-small', 'Text and layout', () => (this.model.settingsOpen = true))

    const config = AbeleConfig.getInstance()
    this.stopWatch = watch(config.version, () => this.applySettings())
    this.registerEvent(this.app.workspace.on('css-change', () => this.applySettings()))
  }

  async onClose(): Promise<void> {
    this.teardown()
    this.stopWatch?.()
    this.vue?.unmount()
    this.vue = null
    await super.onClose()
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file)
    await this.show(file)
  }

  async onUnloadFile(file: TFile): Promise<void> {
    this.teardown()
    await super.onUnloadFile(file)
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source)
    const flow = readerSettingsFrom(AbeleConfig.getInstance().reader).flow
    menu.addItem((item) =>
      item
        .setTitle(
          flow === 'paginated'
            ? 'Scroll instead of turning pages'
            : 'Turn pages instead of scrolling'
        )
        .setIcon(flow === 'paginated' ? 'scroll-text' : 'book-open')
        .setSection('view')
        .onClick(() => void this.setFlow(flow === 'paginated' ? 'scrolled' : 'paginated'))
    )
    menu.addItem((item) =>
      item
        .setTitle('Text and layout…')
        .setIcon('a-large-small')
        .setSection('view')
        .onClick(() => (this.model.settingsOpen = true))
    )
  }

  private async setFlow(flow: 'paginated' | 'scrolled'): Promise<void> {
    const config = AbeleConfig.getInstance()
    config.reader = readerSettingsFrom({ ...config.reader, flow })
    await config.saveSettings()
  }

  private setPanel(open: boolean): void {
    this.model.panel = open
    if (!Platform.isPhone) this.app.saveLocalStorage(PANEL_KEY, open ? '1' : null)
  }

  private closeFootnote(): void {
    const note = this.model.footnote
    this.model.footnote = null
    const view = note?.view as FoliateView | undefined
    view?.close?.()
    view?.remove()
  }

  private teardown(): void {
    this.loadToken++
    this.closeFootnote()
    void bookPlaces()?.flush()
    this.reader?.close()
    this.reader?.remove()
    this.reader = null
    this.opened?.destroy()
    this.opened = null
    this.pages.length = 0
    Object.assign(this.model, emptyBookModel(), { panel: this.model.panel, kind: this.model.kind })
  }

  private fail(message: string): void {
    this.model.status = 'error'
    this.model.message = message
  }

  /** Layout and page style from the settings and the theme, on the book's engine or a note's. */
  private applyTo(view: FoliateView, note = false): void {
    const settings = readerSettingsFrom(AbeleConfig.getInstance().reader)
    const renderer = view.renderer as unknown as HTMLElement & {
      setStyles?: (css: [string, string]) => void
    }
    if (!renderer) return
    if (view.isFixedLayout) {
      if (renderer.getAttribute('zoom') !== settings.pdfZoom)
        renderer.setAttribute('zoom', settings.pdfZoom)
      view.toggleClass(
        'abele-book__engine_dark-pages',
        darkPdfPages(settings, themeValues(this.contentEl).dark)
      )
      return
    }
    const attrs = layoutAttributes(settings, Platform.isPhone)
    if (note) {
      attrs.flow = 'scrolled'
      attrs.margin = '0px'
      attrs.gap = '4%'
      attrs['max-column-count'] = '1'
    }
    for (const [name, value] of Object.entries(attrs))
      if (renderer.getAttribute(name) !== value) renderer.setAttribute(name, value)
    renderer.setStyles?.(pageStyles(settings, themeValues(this.contentEl)))
  }

  private applySettings(): void {
    // Pages side by side are decided when a PDF opens; a change opens it again, at the same page.
    const twoPages = readerSettingsFrom(AbeleConfig.getInstance().reader).pdfTwoPages
    if (this.isPdf && this.opened && this.file && twoPages !== this.openedTwoPages) {
      void bookPlaces()
        ?.flush()
        .then(() => this.file && this.show(this.file))
      return
    }
    if (this.reader) this.applyTo(this.reader)
    const note = this.model.footnote?.view as FoliateView | undefined
    if (note?.renderer) this.applyTo(note, true)
  }

  private async show(file: TFile): Promise<void> {
    this.teardown()
    const token = this.loadToken
    this.model.status = 'loading'
    this.model.message = 'Opening the book…'
    this.model.title = file.basename
    this.model.kind = file.extension === 'pdf' ? 'pdf' : 'epub'
    try {
      const stage = await this.stageReady
      const data = new Uint8Array(await this.app.vault.readBinary(file))
      if (token !== this.loadToken) return
      const settings = readerSettingsFrom(AbeleConfig.getInstance().reader)
      const opened = this.isPdf ? await openPdf(await loadPdfJs(), data) : await openEpub(data)
      if (this.isPdf) {
        this.openedTwoPages = settings.pdfTwoPages
        const rendition = (opened.book.rendition ??= {})
        if (!settings.pdfTwoPages) rendition.spread = 'none'
      }
      if (token !== this.loadToken) {
        opened.destroy()
        return
      }
      await import('@/vendor/foliate-js/view.js')
      frameOptions.sandbox = readerTestHooks.sandbox ?? frameSandbox(Platform)
      stage.empty()
      const reader = stage.createEl('foliate-view', {
        cls: this.isPdf ? 'abele-book__engine abele-book__engine_pdf' : 'abele-book__engine',
      })
      // A custom element is defined per window: in a pop-out window the tag stays a plain element.
      if (typeof reader.open !== 'function') {
        reader.remove()
        opened.destroy()
        this.fail('Books open in the main window only.')
        return
      }
      reader.addEventListener('load', (e) => this.onPage((e as CustomEvent).detail))
      reader.addEventListener('external-link', (e) => this.onExternalLink(e as CustomEvent))
      reader.addEventListener('link', (e) => this.onLink(e))
      reader.addEventListener('relocate', (e) =>
        this.onRelocate((e as CustomEvent<FoliateLocation>).detail)
      )
      reader.history.addEventListener('index-change', () => {
        this.model.canGoBack = !!this.reader?.history.canGoBack
      })
      this.reader = reader
      this.opened = opened
      await reader.open(opened.book)
      if (token !== this.loadToken) return
      this.applyTo(reader)
      this.model.toc = tocEntries(opened.book.toc)
      this.key = bookKey(opened.book.metadata?.identifier, file.path)
      const place = await bookPlaces()?.get(this.key)
      if (token !== this.loadToken) return
      await reader.init({ lastLocation: place?.cfi ?? null, showTextStart: true })
      if (token !== this.loadToken) return
      // The first page of a book is not a place to go back to.
      this.model.canGoBack = false
      this.model.status = 'ready'
    } catch (e) {
      if (token !== this.loadToken) return
      console.error('[Abele] book did not open', e)
      this.teardown()
      this.fail(`This book could not be opened. ${(e as Error).message ?? ''}`.trim())
    }
  }

  private onRelocate(detail: FoliateLocation): void {
    this.model.fraction = detail.fraction ?? 0
    const label = detail.tocItem?.label?.trim() ?? ''
    // A PDF's pages are its own measure: the page number first, the outline entry after it.
    const page = detail.section
      ? `Page ${detail.section.current + 1} of ${detail.section.total}`
      : ''
    this.model.chapter = this.isPdf && page ? [page, label].filter(Boolean).join(' · ') : label
    this.model.currentHref = detail.tocItem?.href ?? null
    const file = this.file
    if (detail.cfi && file && this.key && this.model.status === 'ready')
      void bookPlaces()?.set(this.key, {
        cfi: detail.cfi,
        fraction: detail.fraction ?? 0,
        path: file.path,
      })
  }

  /** A link inside the book: a note opens in its dialog, anything else is followed. */
  private onLink(e: Event): void {
    // A PDF has no notes to open in a dialog: its links go to their page.
    if (!this.opened || this.isPdf) return
    const href = (e as CustomEvent<{ href?: string }>).detail?.href ?? ''
    this.footnoteHref = href
    const done = this.footnotes.handle(this.opened.book, e)
    // A mark that looked like a note and was not one: the link is followed after all.
    done?.catch((err) => {
      console.warn('[Abele] a note could not be shown', err)
      this.closeFootnote()
      if (href) void this.reader?.goTo(href)
    })
  }

  /** Every page, as it arrives in its frame: audited, and wired for keys and taps. */
  private onPage({ doc, index }: { doc: Document; index: number }, main = true): void {
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
    if (!main) return
    doc.addEventListener('keydown', (e) => this.onKey(e))
    doc.addEventListener('click', (e) => this.onTap(e, doc))
    // The engine turns a reflowing book's pages under a finger itself; a PDF's it does not.
    if (this.reader?.isFixedLayout) this.watchSwipes(doc)
  }

  private watchSwipes(doc: Document): void {
    let start: { x: number; y: number; t: number } | null = null
    doc.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches[0]
        start = e.touches.length === 1 && t ? { x: t.screenX, y: t.screenY, t: e.timeStamp } : null
      },
      { passive: true }
    )
    doc.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0]
      if (!start || !t || !this.reader) return
      const way = swipeDirection(start, { x: t.screenX, y: t.screenY, t: e.timeStamp })
      start = null
      if (way === 'left') void this.reader.goRight()
      else if (way === 'right') void this.reader.goLeft()
    })
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
    const stage = this.stage
    const width = stage?.clientWidth ?? 0
    if (!stage || !width) return
    const frame = doc.defaultView?.frameElement
    const x =
      e.clientX + (frame?.getBoundingClientRect().left ?? 0) - stage.getBoundingClientRect().left
    if (x < width * 0.25) void this.reader.goLeft()
    else if (x > width * 0.75) void this.reader.goRight()
  }

  onload(): void {
    super.onload()
    this.registerDomEvent(this.contentEl, 'keydown', (e) => {
      if ((e.target as Element | null)?.closest?.('input, select, textarea')) return
      this.onKey(e)
    })
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
