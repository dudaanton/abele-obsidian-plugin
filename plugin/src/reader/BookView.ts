/**
 * A tab showing one book from the vault.
 *
 * The book is drawn by foliate-js, one chapter per sandboxed frame; everything that keeps the
 * book's own code from running is in `bookSafety.ts`, and this view adds the last check — every
 * page is audited as it arrives, and one that fails is emptied before it is shown. Around the
 * page, a Vue side (`BookReader.vue`) shows the contents, the progress and the dialogs.
 */
import { FileView, Platform, TFile, type Menu, type WorkspaceLeaf } from 'obsidian'
import { createApp, reactive, watch, type App as VueApp, type WatchStopHandle } from 'vue'
import { frameOptions } from '@/vendor/foliate-js/frame-options.js'
import { tagName } from '@/vendor/foliate-js/elements.js'
import type { FoliateLocation, View as FoliateView } from '@/vendor/foliate-js/view.js'
import { FootnoteHandler } from '@/vendor/foliate-js/footnotes.js'
import BookReader from '@/components/reader/BookReader.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { auditDocument, blankDocument, frameSandbox } from './bookSafety'
import type { OpenedBook } from './openBook'
import { openBookFile } from './openFile'
import { emptyBookModel, tocEntries, type BookModel, type PanelTab } from './model'
import {
  darkPdfPages,
  layoutAttributes,
  pageStyles,
  pdfZoomFor,
  readerSettingsFrom,
  themeValues,
} from './settings'
import type { PdfBookExtras } from './pdfBook'
import { BookReading } from './BookReading'
import { parsePlaceSubpath, type BookPlace } from './bookLinks'
import { onExternalLink, onKey, pinchZoom, watchPage, type PageHost } from './pageInput'
import { bookCallbacks, type BookActions } from './bookCallbacks'
import { bookKey } from './positions'
import { bookPlaces, followPlace } from './places'
import { progressOf } from './readingProgress'
import { nameOf } from './bookText'
import { fillBookMenu, fillZoomMenu } from './bookMenu'
import { bookScope, zoomStep } from './zoom'
import { PDF_SCROLL_TAG, definePdfScroll } from './pdfScroll'

/** The settings a PDF's layout is decided by when it opens. */
const pdfLayoutKey = (s: { pdfLayout: string; pdfTwoPages: boolean }) =>
  `${s.pdfLayout}:${s.pdfTwoPages}`

export { BOOK_VIEW_TYPE, BOOK_EXTENSIONS, READER_EXTENSIONS, readerTestHooks } from './viewType'
export type { PageReport } from './viewType'
import { BOOK_VIEW_TYPE, READER_EXTENSIONS, readerTestHooks, type PageReport } from './viewType'

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
  /** Stops following the book's place as other devices move it. */
  private stopNewer: (() => void) | null = null
  private footnotes = new FootnoteHandler()
  private footnoteHref = ''
  /** How a PDF was laid out when it opened: a change to either opens it again. */
  private openedPdfLayout = ''
  /** A zoom chosen in this tab — keys, a pinch — over the setting's; not saved. */
  private zoomOverride: string | null = null
  /** Selections, highlights, links and search, once a book is showing. */
  reading: BookReading | null = null
  /** A place a link asked for, gone to once the book is open. */
  private pendingPlace: BookPlace | null = null
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
  /** Whether the book's pages are pictures of a fixed size — a PDF, a comic — which zoom. */
  get fixed(): boolean {
    return !!this.reader?.isFixedLayout
  }

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
    this.vue = createApp(BookReader, { model: this.model, ...bookCallbacks(this.actions()) })
    this.vue.mount(mount)

    this.addAction('audio-lines', 'Read aloud', () => this.reading?.speech.toggle())
    this.addAction('search', 'Search in the book', () => this.openSearch())
    this.addAction('list', 'Contents', () => this.showPanel('contents'))
    this.addAction('a-large-small', 'Text and layout', () => (this.model.settingsOpen = true))

    const config = AbeleConfig.getInstance()
    this.stopWatch = watch(config.version, () => this.applySettings())
    this.model.canAsk = !!AbeleConfig.getInstance().ai?.enabled
    this.registerEvent(
      this.app.workspace.on('css-change', () => {
        this.applySettings()
        this.reading?.marks.redraw()
      })
    )
    // The highlights note, changed by hand, on another device, or by the reader itself.
    const noteChanged = (file: unknown) => {
      if (file instanceof TFile && file.extension === 'md') this.reading?.noteChanged(file.path)
    }
    // Read once its properties are parsed: they are what say whose note it is.
    this.registerEvent(this.app.metadataCache.on('changed', noteChanged))
    this.registerEvent(this.app.vault.on('delete', noteChanged))
    this.scope = bookScope(this.app.scope, {
      search: () => this.openSearch(),
      pdf: () => this.fixed,
      zoom: (way) => this.zoom(way),
    })
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
    fillBookMenu(menu, {
      ready: !!this.reading && this.model.status === 'ready',
      pdf: this.isPdf,
      canAsk: this.model.canAsk,
      copyLink: () => void this.reading?.copyLink(),
      ask: () => void this.reading?.ask(),
      openSearch: () => this.openSearch(),
      showHighlights: () => this.showPanel('highlights'),
      openSettings: () => (this.model.settingsOpen = true),
    })
    if (this.fixed) fillZoomMenu(menu, (way) => this.zoom(way))
  }

  /** What the tab's Vue side can ask of it. */
  private actions(): BookActions {
    return {
      model: this.model,
      reader: () => this.reader,
      reading: () => this.reading,
      setStage: (el) => {
        this.stage = el
        this.resolveStage(el)
      },
      setPanel: (open) => this.setPanel(open),
      closeFootnote: () => this.closeFootnote(),
      footnoteHref: () => this.footnoteHref,
      commentOnSelection: () => this.commentOnSelection(),
    }
  }

  /** A PDF zoomed a step in or out, or back to the setting's zoom. */
  zoom(way: 'in' | 'out' | 'reset'): void {
    if (!this.fixed || !this.reader) return
    const renderer = this.reader.renderer as unknown as HTMLElement & { scale?: number }
    const now = renderer.scale ?? (Number(renderer.getAttribute('zoom')) || 1)
    this.zoomOverride = way === 'reset' ? null : String(zoomStep(now, way === 'in'))
    this.applyTo(this.reader)
  }

  /** Opens the side panel on a list, or closes it when that list is already showing. */
  private showPanel(tab: PanelTab): void {
    if (this.model.panel && this.model.panelTab === tab) {
      this.setPanel(false)
      return
    }
    this.model.panelTab = tab
    this.setPanel(true)
  }

  openSearch(): void {
    this.model.panelTab = 'search'
    this.setPanel(true)
  }

  /** The selected words highlighted, and the dialog for a comment on them opened. */
  private async commentOnSelection(): Promise<void> {
    const h = await this.reading?.highlight('yellow')
    if (h) this.model.commenting = { ...h }
  }

  /** A link to a place in this book was followed: `#cfi=…` or `#page=N`. */
  setEphemeralState(state: unknown): void {
    super.setEphemeralState(state)
    const place = parsePlaceSubpath((state as { subpath?: string } | null)?.subpath)
    if (!place) return
    if (this.reading && this.model.status === 'ready') void this.reading.goToPlace(place)
    else this.pendingPlace = place
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
    this.stopNewer?.()
    this.stopNewer = null
    this.closeFootnote()
    this.reading?.stopSearch()
    this.reading?.speech.stop()
    this.reading = null
    void bookPlaces()?.flush()
    this.reader?.close()
    this.reader?.remove()
    this.reader = null
    this.opened?.destroy()
    this.opened = null
    this.pages.length = 0
    const { panel, kind, canAsk } = this.model
    Object.assign(this.model, emptyBookModel(), { panel, kind, canAsk })
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
      // A comic or a fixed-layout book fits its page: its pictures are the page.
      const zoom = this.zoomOverride ?? (this.isPdf ? pdfZoomFor(settings) : 'fit-page')
      if (renderer.getAttribute('zoom') !== zoom) renderer.setAttribute('zoom', zoom)
      const dark = this.isPdf && darkPdfPages(settings, themeValues(this.contentEl).dark)
      view.toggleClass('abele-book__engine_dark-pages', dark)
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
    this.model.canAsk = !!AbeleConfig.getInstance().ai?.enabled
    // A PDF's layout is decided when it opens; a change opens it again, at the same page.
    const layout = pdfLayoutKey(readerSettingsFrom(AbeleConfig.getInstance().reader))
    if (this.isPdf && this.opened && this.file && layout !== this.openedPdfLayout) {
      void bookPlaces()
        ?.flush()
        .then(() => this.file && this.show(this.file))
      return
    }
    if (this.reader) this.applyTo(this.reader)
    this.reading?.settingsChanged()
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
      const opened = await openBookFile(file, data)
      if (this.isPdf) {
        this.openedPdfLayout = pdfLayoutKey(settings)
        const rendition = (opened.book.rendition ??= {})
        if (!settings.pdfTwoPages) rendition.spread = 'none'
        if (settings.pdfLayout === 'scrolled') {
          definePdfScroll(stage.win)
          opened.book.fixedLayoutRenderer = PDF_SCROLL_TAG
        }
      }
      if (token !== this.loadToken) {
        opened.destroy()
        return
      }
      await import('@/vendor/foliate-js/view.js')
      frameOptions.sandbox = readerTestHooks.sandbox ?? frameSandbox(Platform)
      stage.empty()
      const reader = stage.createEl(tagName('foliate-view') as 'foliate-view', {
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
      reader.addEventListener('external-link', (e) => onExternalLink(e as CustomEvent))
      reader.addEventListener('link', (e) => this.onLink(e))
      // A pinch over the gaps between a PDF's pages, which no page frame hears.
      if (this.isPdf)
        reader.addEventListener('wheel', pinchZoom(this.pageHost()), { passive: false })
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
      this.key = bookKey(opened.book.metadata?.identifier, file.path)
      this.model.key = this.key
      const meta = opened.book.metadata
      this.reading = new BookReading(
        this.app,
        file,
        reader as unknown as ConstructorParameters<typeof BookReading>[2],
        this.model,
        this.contentEl,
        this.isPdf ? (opened.book as unknown as PdfBookExtras) : null,
        () => ({ key: this.key, title: nameOf(meta?.title), author: nameOf(meta?.author) })
      )
      void this.reading.loadHighlights()
      if (!this.isPdf && reader.isFixedLayout) this.model.kind = 'fixed'
      this.model.toc = tocEntries(opened.book.toc)
      const place = await bookPlaces()?.get(this.key)
      if (token !== this.loadToken) return
      await reader.init({ lastLocation: place?.cfi ?? null, showTextStart: true })
      // Read further on another device while open here: the tab follows, rather than writing
      // this older place back over it at the next page turn.
      this.stopNewer = followPlace(
        this.key,
        () => reader.lastLocation?.cfi,
        (cfi) => reader.goTo(cfi)
      )
      if (token !== this.loadToken) return
      const asked = this.pendingPlace
      this.pendingPlace = null
      if (asked) await this.reading.goToPlace(asked)
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
    const index = (detail as { index?: number }).index ?? detail.section?.current
    if (typeof index === 'number') this.reading?.relocated(index)
    this.model.fraction = detail.fraction ?? 0
    this.model.progress = this.isPdf ? null : progressOf(detail, this.reader?.renderer as never)
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
    this.reading?.watchSelection(doc, index)
    // A PDF's pages say when they are drawn; another book's fixed pages are drawn as they load.
    if (this.fixed && !this.isPdf) this.reading?.marks.drawPdf(doc, index)
    watchPage(this.pageHost(), doc)
  }

  private pageHost(): PageHost {
    return {
      reader: () => this.reader,
      stage: () => this.stage,
      reading: () => this.reading,
      model: this.model,
      pdf: this.isPdf,
      fixed: () => this.fixed,
      zoom: (way) => this.zoom(way),
    }
  }

  onload(): void {
    super.onload()
    this.registerDomEvent(this.contentEl, 'keydown', (e) => {
      if ((e.target as Element | null)?.closest?.('input, select, textarea')) return
      onKey(this.reader, e)
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
