/**
 * What a person does with an open book beyond turning its pages: selecting words, highlighting
 * them, linking to a place, going to a place a link names, and searching. One per open book; the
 * tab makes it once the book is showing and drops it when the book closes.
 */
import { MarkdownView, Notice, type App, type TFile } from 'obsidian'
import { flashLines } from '@/lineLinks/open'
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import { insertOnOwnLine } from '@/helpers/editorHelpers'
import { recentNoteView } from '@/github/linking'
import { textWalker } from '@/vendor/foliate-js/text-walker.js'
import { searchMatcher } from '@/vendor/foliate-js/search.js'
import { linkToPlace, quoteWithLink, type BookPlace } from './bookLinks'
import {
  deleteHighlight,
  highlightAt,
  noteFor,
  notesOf,
  readHighlights,
  saveHighlight,
  type NotesPlace,
} from './companion'
import type { Highlight, HighlightColor } from './highlights'
import { BookMarks } from './marks'
import { ReadAloud } from './readAloud'
import { notesTargetFor, readerSettingsFrom } from './settings'
import { AbeleConfig } from '@/services/AbeleConfig'
import { Overlayer } from '@/vendor/foliate-js/overlayer.js'
import { emptySearch, type BookModel, type SearchGroup } from './model'
import type { PdfBookExtras, PdfPageDrawn } from './pdfBook'

interface Engine extends FoliateView {
  getCFI(index: number, range?: Range): string
  getProgressOf(index: number, range: Range): { tocItem?: { label?: string } | null }
  search(opts: { query: string; draw?: unknown; drawOptions?: unknown }): AsyncGenerator<unknown>
  clearSearch(): void
  resolveNavigation(target: string | number): { index: number } | null
}

export class BookReading {
  readonly marks: BookMarks
  readonly speech: ReadAloud
  private docIndex = new WeakMap<Document, number>()
  /** The words last selected, where reading aloud can start. */
  private selectedRange: Range | null = null
  private searchToken = 0
  /** A PDF search match to select once its page is drawn. */
  private pendingMatch: { index: number; occurrence: number; query: string } | null = null
  /** A place in a PDF a link named, to select once its page is drawn. */
  private pendingCfi: string | null = null
  /** The notes the highlights were last read from, so their deletion is noticed too. */
  private notePaths: string[] = []
  /** Where new highlights went when they were last read, to notice the choice change. */
  private targetSeen = ''

  constructor(
    private readonly app: App,
    private readonly file: TFile,
    private readonly engine: Engine,
    private readonly model: BookModel,
    private readonly themeEl: HTMLElement,
    private readonly pdf: (PdfBookExtras & object) | null,
    /** The book's key, title and author, which say where its highlights go. */
    private readonly book: () => { key: string; title: string; author: string }
  ) {
    // Pages of a fixed size — a PDF, a comic, a fixed-layout book — have no overlay in the
    // engine: the reader marks them itself.
    this.marks = new BookMarks(engine, themeEl, !!pdf || engine.isFixedLayout, (h) =>
      this.activate(h)
    )
    this.speech = new ReadAloud(
      engine as unknown as ConstructorParameters<typeof ReadAloud>[0],
      (doc) => this.docIndex.get(doc),
      themeEl,
      () => {
        const s = readerSettingsFrom(AbeleConfig.getInstance().reader)
        return { voice: s.ttsVoice, rate: s.ttsRate }
      },
      (state) => (this.model.speech = state)
    )
    pdf?.pageEvents.addEventListener('drawn', (e) => {
      const { doc, index } = (e as CustomEvent<PdfPageDrawn>).detail
      this.marks.drawPdf(doc, index)
      // A page is drawn again at every new size, and its text with it: what was asked to be
      // marked on it is marked again, until another page is shown.
      if (this.pendingMatch?.index === index) this.selectMatch(doc, this.pendingMatch)
      if (this.pendingCfi && this.engine.resolveNavigation(this.pendingCfi)?.index === index)
        this.selectCfi(doc, this.pendingCfi)
    })
  }

  // ————— Highlights —————

  /** Where this book's highlights go, as the settings say now. */
  where(): NotesPlace {
    const { key, title, author } = this.book()
    const settings = readerSettingsFrom(AbeleConfig.getInstance().reader)
    return { title, author, target: notesTargetFor(settings, key) }
  }

  /** The notes this book's highlights may be in, as the settings say now. */
  notes(): TFile[] {
    return notesOf(this.app, this.file, this.where())
  }

  /** Reads the book's highlights notes and shows what they hold. */
  async loadHighlights(): Promise<void> {
    const where = this.where()
    this.targetSeen = JSON.stringify(where.target)
    this.notePaths = this.notes().map((n) => n.path)
    const list = await readHighlights(this.app, this.file, where)
    this.model.highlights = list
    this.marks.set(list)
    if (this.model.active)
      this.model.active = list.find((h) => h.cfi === this.model.active?.cfi) ?? null
  }

  /** The settings changed: the highlights are read again if where they go did. */
  settingsChanged(): void {
    if (JSON.stringify(this.where().target) !== this.targetSeen) void this.loadHighlights()
  }

  /** Whether a changed file is one of this book's highlights notes, which are then read again. */
  noteChanged(path: string): boolean {
    if (!this.notePaths.includes(path) && !this.notes().some((n) => n.path === path)) return false
    void this.loadHighlights()
    return true
  }

  /** A highlight tapped: its bar, and — for a discussion — its chat, opened again. */
  private activate(h: Highlight): void {
    this.model.selection = null
    this.model.active = h
    if (h.discussion) void this.discuss(h)
  }

  /** The selected words highlighted in a colour; the note is made if there is none. */
  async highlight(color: HighlightColor, comment?: string): Promise<Highlight | null> {
    const sel = this.model.selection
    if (!sel) return null
    // Words already asked about keep their discussion when they are highlighted.
    const known = this.model.highlights.find((x) => x.cfi === sel.cfi)
    const h: Highlight = {
      cfi: sel.cfi,
      color,
      text: sel.text,
      comment: comment ?? known?.comment ?? '',
      label: sel.label,
      ...(known?.discussion ? { discussion: known.discussion } : {}),
    }
    this.clearSelection()
    await this.save(h)
    return h
  }

  async save(h: Highlight): Promise<void> {
    try {
      const chat = h.discussion
        ? (await import('./bookDiscussions')).discussionPath(h.discussion)
        : undefined
      await saveHighlight(this.app, this.file, this.where(), h, chat)
      await this.loadHighlights()
      if (this.model.active?.cfi === h.cfi) this.model.active = { ...h }
    } catch (e) {
      new Notice(`The highlight could not be saved: ${(e as Error).message}`)
    }
  }

  /**
   * Removes a highlight. One carrying a discussion asks first what becomes of its chat: kept as
   * an ordinary chat, or deleted with the mark.
   */
  async remove(h: Highlight): Promise<void> {
    if (h.discussion) {
      const { askWhatToRemove, releaseDiscussion } = await import('./bookDiscussions')
      const choice = await askWhatToRemove(h)
      if (!choice) return
      await releaseDiscussion(h.discussion, choice)
    }
    await deleteHighlight(this.app, this.file, this.where(), h.cfi)
    this.model.active = null
    await this.loadHighlights()
  }

  /** Opens the highlights note — at the highlight `h`, flashed, when it is one of its callouts. */
  async openNote(h?: Highlight): Promise<void> {
    const at = h ? await highlightAt(this.app, this.file, this.where(), h.cfi) : null
    const note = at?.note ?? (await noteFor(this.app, this.file, this.where(), h?.cfi))
    if (!note) return
    const leaf = this.app.workspace.getLeaf('tab')
    await leaf.openFile(note)
    if (h) this.model.active = null
    if (at && leaf.view instanceof MarkdownView) await flashLines(leaf.view, at.lines)
  }

  // ————— Selection —————

  /** The page on screen changed: what was waiting to be marked on another page is dropped. */
  relocated(index: number): void {
    if (this.pendingMatch && this.pendingMatch.index !== index) this.pendingMatch = null
    if (this.pendingCfi && this.engine.resolveNavigation(this.pendingCfi)?.index !== index)
      this.pendingCfi = null
  }

  /** Watches a page for words being selected. */
  watchSelection(doc: Document, index: number): void {
    this.docIndex.set(doc, index)
    let timer = 0
    doc.addEventListener('selectionchange', () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => this.readSelection(doc), 250)
    })
  }

  private readSelection(doc: Document): void {
    const sel = doc.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      if (this.model.selection) this.model.selection = null
      return
    }
    const range = sel.getRangeAt(0)
    this.selectedRange = range.cloneRange()
    const text = sel.toString().trim()
    const index = this.docIndex.get(doc)
    if (!text || index === undefined) return
    try {
      const cfi = this.engine.getCFI(index, range)
      // Words that are a highlight already — a link to one followed — offer the highlight.
      const known = this.model.highlights.find((h) => h.cfi === cfi)
      if (known) {
        this.model.selection = null
        this.model.active = known
        return
      }
      this.model.active = null
      this.model.selection = { cfi, text, label: this.labelOf(index, range) }
    } catch (e) {
      console.debug('[Abele] no place for the selection', e)
    }
  }

  private labelOf(index: number, range?: Range): string {
    if (this.pdf) return `Page ${index + 1}`
    try {
      return this.engine.getProgressOf(index, range)?.tocItem?.label?.trim() ?? ''
    } catch {
      return ''
    }
  }

  /** Reads aloud from the words selected, the selection let go. */
  readFromSelection(): void {
    const from = this.selectedRange
    this.clearSelection()
    this.speech.toggle(from)
  }

  clearSelection(): void {
    this.model.selection = null
    for (const { doc } of this.engine.renderer.getContents()) doc?.getSelection()?.removeAllRanges()
  }

  // ————— Links —————

  /** A link to the selection, a highlight, or else the page on screen. */
  linkTo(target?: { cfi: string; label: string }): string {
    const here = target ?? this.hereTarget()
    const place: BookPlace =
      this.pdf && !target
        ? { page: (this.engine.renderer as unknown as { index: number }).index + 1 }
        : { cfi: here.cfi }
    return linkToPlace(this.app, this.file, place, here.label || this.file.basename)
  }

  private hereTarget(): { cfi: string; label: string } {
    const loc = this.engine.lastLocation
    return { cfi: loc?.cfi ?? '', label: loc?.tocItem?.label?.trim() ?? '' }
  }

  async copyLink(target?: { cfi: string; label: string }): Promise<void> {
    await navigator.clipboard.writeText(this.linkTo(target))
    new Notice('Link copied')
  }

  /** The words with a link to them, written into the note the person was last in. */
  quoteIntoNote(target: { cfi: string; label: string; text: string }): boolean {
    const view = recentNoteView(this.app)
    if (!view) {
      new Notice('Open a note to put the quote in')
      return false
    }
    const end = insertOnOwnLine(view.editor, quoteWithLink(target.text, this.linkTo(target)))
    view.editor.setCursor(end)
    new Notice(`Quote added to ${view.file?.basename ?? 'the note'}`)
    return true
  }

  /** A new chat with a link to the words, or to the page on screen, and the words quoted. */
  /**
   * "Ask here". On words — selected, or a highlight — a discussion kept with them: the one
   * already held about them, opened again, or a new one, listed in the highlights note and
   * marked in the book. With no words, a chat about the page, as before.
   */
  async ask(target?: { cfi: string; label: string; text: string }): Promise<void> {
    if (!target?.text.trim()) {
      const { askAboutBook } = await import('./askAboutBook')
      await askAboutBook(this.file, this.linkTo(target), target?.text)
      return
    }
    const known = this.model.highlights.find((h) => h.cfi === target.cfi)
    if (known?.discussion && (await this.discuss(known))) return
    const { startDiscussion } = await import('./bookDiscussions')
    const id = await startDiscussion(this.file, target.cfi, target.text)
    if (!id) return
    this.clearSelection()
    this.model.active = null
    await this.save(
      known
        ? { ...known, discussion: id }
        : {
            cfi: target.cfi,
            color: 'yellow',
            text: target.text,
            comment: '',
            label: target.label,
            discussion: id,
            plain: true,
          }
    )
  }

  /** Opens a highlight's discussion again; false when its chat is gone. */
  async discuss(h: Highlight): Promise<boolean> {
    if (!h.discussion) return false
    const { openDiscussion } = await import('./bookDiscussions')
    const opened = await openDiscussion(h.discussion)
    if (!opened) new Notice('The chat of this discussion is gone. Ask here to start a new one.')
    return opened
  }

  /** The discussions held about words on the page on screen, for the agent. */
  discussionsOnScreen(): Highlight[] {
    const visible = this.engine.lastLocation?.range
    // Pages of a PDF are whole documents: a discussion is on the page on screen or not.
    const page = (this.engine.lastLocation as { section?: { current: number } } | null)?.section
    if (this.pdf || !visible)
      return this.model.highlights.filter(
        (h) =>
          !!h.discussion &&
          page !== undefined &&
          (this.engine.resolveNavigation(h.cfi) as { index?: number } | null)?.index ===
            page.current
      )
    return this.model.highlights.filter((h) => {
      if (!h.discussion) return false
      if (!visible) return false
      const doc = visible.startContainer.ownerDocument
      const resolved = this.engine.resolveNavigation(h.cfi) as {
        anchor?: (d: Document) => Range | Element | null
      } | null
      const anchor = doc ? resolved?.anchor?.(doc) : null
      if (!anchor) return false
      try {
        const range = anchor instanceof doc.defaultView.Range ? anchor : doc.createRange()
        if (!(anchor instanceof doc.defaultView.Range)) range.selectNode(anchor)
        // Overlapping the page: not ending before it, not starting after it.
        return (
          visible.comparePoint(range.endContainer, range.endOffset) >= 0 &&
          visible.comparePoint(range.startContainer, range.startOffset) <= 0
        )
      } catch {
        return false
      }
    })
  }

  /** Goes to a place a link named, and marks it. */
  async goToPlace(place: BookPlace): Promise<void> {
    if ('page' in place) {
      await this.engine.goTo(Math.min(place.page, this.engine.book.sections.length) - 1)
      return
    }
    if (this.pdf) {
      // A PDF's text is drawn a moment after its page: the words are selected once it is.
      this.pendingMatch = null
      this.pendingCfi = place.cfi
      await this.engine.goTo(place.cfi)
      for (const { doc } of this.engine.renderer.getContents())
        if (doc?.querySelector('.textLayer span')) this.selectCfi(doc, place.cfi)
      return
    }
    await this.engine.select(place.cfi)
  }

  private selectCfi(doc: Document, cfi: string): void {
    const anchor = (
      this.engine.resolveNavigation(cfi) as { anchor?: (d: Document) => Range | null } | null
    )?.anchor?.(doc)
    if (!anchor) return
    const sel = doc.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(anchor)
  }

  // ————— Search —————

  /** Searches the whole book, showing results as they are found; a new search stops the last. */
  async search(query: string): Promise<void> {
    const token = ++this.searchToken
    this.stopSearch(false)
    const q = query.trim()
    this.model.search = { ...emptySearch(), query }
    if (q.length < 2) return
    this.model.search.running = true
    const groups: SearchGroup[] = []
    const publish = () => {
      this.model.search.groups = groups.map((g) => ({ ...g, hits: [...g.hits] }))
      this.model.search.count = groups.reduce((n, g) => n + g.hits.length, 0)
    }
    try {
      if (this.pdf) {
        for await (const found of this.pdf.searchPages(q, () => token !== this.searchToken)) {
          if (token !== this.searchToken) return
          if ('progress' in found) this.model.search.progress = found.progress
          else {
            groups.push({
              label: `Page ${found.index + 1}`,
              hits: found.items.map((item) => ({
                cfi: this.engine.getCFI(found.index),
                index: found.index,
                occurrence: item.occurrence,
                excerpt: item.excerpt,
              })),
            })
            publish()
          }
        }
      } else {
        const accent = getComputedStyle(this.themeEl).getPropertyValue('--text-accent').trim()
        const search = this.engine.search({
          query: q,
          draw: Overlayer.outline,
          drawOptions: { color: accent || 'Highlight', width: 2, radius: 3 },
        })
        for await (const found of search) {
          if (token !== this.searchToken) return
          if (found === 'done') break
          const r = found as {
            progress?: number
            label?: string
            subitems?: { cfi: string; excerpt: SearchGroup['hits'][0]['excerpt'] }[]
          }
          if (typeof r.progress === 'number') this.model.search.progress = r.progress
          if (r.subitems) {
            groups.push({
              label: r.label?.trim() || 'Untitled',
              hits: r.subitems.map((s) => ({ cfi: s.cfi, excerpt: s.excerpt })),
            })
            publish()
          }
        }
      }
    } catch (e) {
      console.warn('[Abele] book search failed', e)
    } finally {
      if (token === this.searchToken) {
        this.model.search.running = false
        this.model.search.progress = 1
      }
    }
  }

  stopSearch(clear = true): void {
    if (clear) {
      this.searchToken++
      this.model.search = emptySearch()
    }
    if (!this.pdf) this.engine.clearSearch()
    this.pendingMatch = null
  }

  /** Goes to one search result and marks the words. */
  async goToHit(hit: { cfi: string; index?: number; occurrence?: number }): Promise<void> {
    if (this.pdf && hit.index !== undefined) {
      this.pendingCfi = null
      this.pendingMatch = {
        index: hit.index,
        occurrence: hit.occurrence ?? 0,
        query: this.model.search.query.trim(),
      }
      await this.engine.goTo(hit.index)
      for (const { doc } of this.engine.renderer.getContents())
        if (doc?.querySelector('.textLayer span') && this.pendingMatch)
          this.selectMatch(doc, this.pendingMatch)
      return
    }
    await this.engine.goTo(hit.cfi)
  }

  private selectMatch(doc: Document, match: { occurrence: number; query: string }): void {
    const matcher = searchMatcher(textWalker, { defaultLocale: 'en' })
    let n = 0
    for (const { range } of matcher(doc, match.query)) {
      if (n++ !== match.occurrence) continue
      const sel = doc.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      range.startContainer.parentElement?.scrollIntoView?.({
        block: 'center',
      })
      return
    }
  }
}
