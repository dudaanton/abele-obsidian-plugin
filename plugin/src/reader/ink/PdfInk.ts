/**
 * Drawing on an open PDF: the ink of its pages, drawn on them as they are drawn, and drawing mode
 * itself — the sheet over the pages (`inkOverlay.ts`), the tools, undo, the keys, and writing what
 * was drawn to the vault (`inkStore.ts`). One per open PDF; the tab makes it once the book shows.
 *
 * Drawing is a mode, turned on and off with a button: while it is on the pages answer the pen and
 * nothing else, and when it goes off everything answers as before.
 */
import { Platform, Scope, type App, type EventRef, type TAbstractFile, type TFile } from 'obsidian'
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import type { PdfBookExtras, PdfPageDrawn } from '../pdfBook'
import type { NotesPlace } from '../companion'
import type { BookModel } from '../model'
import { InkHistory, type InkStep } from './inkHistory'
import { InkOverlay, type InkOverlayHost, type InkPageHit } from './inkOverlay'
import { InkStore } from './inkStore'
import { drawInk, pageSizeOf } from './inkLayer'
import { routePointer } from './inkRoute'
import { hitStroke, type InkColor, type InkStroke } from './stroke'
import type { InkPage } from './inkFile'
import { inkBrush, type InkToolName } from './inkModel'
import type { Thickness } from '@/drawing/model'
import { readerSettingsFrom } from '../settings'
import { AbeleConfig } from '@/services/AbeleConfig'
import { zoomedPast, type PdfZoom } from '../pdfZoom'

export interface PdfInkHost {
  app: App
  file: TFile
  engine: FoliateView
  pdf: PdfBookExtras
  model: BookModel
  stage(): HTMLElement | null
  where(): NotesPlace
  zoom(way: 'in' | 'out'): void
  /** The PDF's smooth zoom, which a pinch on the sheet goes to. */
  zoomer?(): PdfZoom | null
}

/** How long after the last stroke a page is written. */
const WRITE_AFTER = 600

export class PdfInk {
  private readonly pages = new Map<number, InkPage>()
  private readonly history = new InkHistory()
  private readonly store: InkStore
  private readonly docIndex = new WeakMap<Document, number>()
  private overlay: InkOverlay | null = null
  private scope: Scope | null = null
  private dirty = new Set<number>()
  private timer = 0
  private writing: Promise<void> = Promise.resolve()
  private penDown = false
  private penSeen = false
  /** What the eraser has taken in the touch under way, page by page. */
  private erased = new Map<number, InkStep>()
  private readonly refs: EventRef[] = []
  private readonly onDrawn = (e: Event) => {
    const { doc, index } = (e as CustomEvent<PdfPageDrawn>).detail
    this.docIndex.set(doc, index)
    drawInk(doc, this.pages.get(index))
  }

  constructor(private readonly h: PdfInkHost) {
    this.store = new InkStore(h.app, h.file, () => h.where())
    h.pdf.pageEvents.addEventListener('drawn', this.onDrawn)
    const changed = (file: TAbstractFile): void => void this.fileChanged(file.path)
    this.refs.push(h.app.vault.on('create', changed))
    this.refs.push(h.app.vault.on('modify', changed))
    this.refs.push(h.app.vault.on('delete', changed))
  }

  /** Reads the book's ink and draws it on the pages already showing. */
  async load(): Promise<void> {
    const all = await this.store.readAll()
    for (const [index, page] of all) {
      this.pages.set(index, page)
      this.redraw(index)
    }
  }

  get on(): boolean {
    return this.h.model.ink.on
  }

  // ————— Drawing mode —————

  start(): void {
    const stage = this.h.stage()
    if (this.on || !stage) return
    const ink = this.h.model.ink
    ink.touch = Platform.isMobile
    // As chosen last, on this device or another: it travels with the reader's settings.
    ink.thickness = readerSettingsFrom(AbeleConfig.getInstance().reader).pdfInkThickness
    // A phone has no pen: its finger draws. A tablet's finger moves the pages, and the pen draws.
    if (!this.penSeen) ink.finger = Platform.isPhone
    // Words selected, a highlight's bar open: put away, the bar's row is the pen's now.
    this.h.model.selection = null
    this.h.model.active = null
    for (const { doc } of this.contents()) doc.getSelection()?.removeAllRanges()
    const dark = this.h.engine.classList.contains('abele-book__engine_dark-pages')
    this.overlay = new InkOverlay(stage, this.overlayHost(), dark)
    const scope = new Scope(this.h.app.scope)
    scope.register([], 'Escape', () => {
      this.stop()
      return false
    })
    scope.register(['Mod'], 'z', () => {
      this.undo()
      return false
    })
    scope.register(['Mod', 'Shift'], 'z', () => {
      this.redo()
      return false
    })
    this.h.app.keymap.pushScope(scope)
    this.scope = scope
    ink.on = true
    this.sync()
  }

  stop(): void {
    this.overlay?.destroy()
    this.overlay = null
    if (this.scope) this.h.app.keymap.popScope(this.scope)
    this.scope = null
    this.penDown = false
    this.h.model.ink.on = false
    void this.flush()
  }

  toggle(): void {
    if (this.on) this.stop()
    else this.start()
  }

  setTool(tool: InkToolName): void {
    this.h.model.ink.tool = tool
  }

  /** A colour for the tool in hand; the eraser has none, and the pen's is kept for it. */
  setColor(color: InkColor): void {
    const ink = this.h.model.ink
    if (ink.tool === 'marker') ink.markerColor = color
    else {
      ink.penColor = color
      if (ink.tool === 'eraser') ink.tool = 'pen'
    }
  }

  /** How thick the pen and the marker draw, kept for every PDF from now on. */
  setThickness(thickness: Thickness): void {
    this.h.model.ink.thickness = thickness
    const config = AbeleConfig.getInstance()
    config.reader = readerSettingsFrom({ ...config.reader, pdfInkThickness: thickness })
    void config.saveSettings()
  }

  setFinger(on: boolean): void {
    this.h.model.ink.finger = on
  }

  undo(): void {
    const step = this.history.undo()
    if (step) this.apply(step, false)
  }

  redo(): void {
    const step = this.history.redo()
    if (step) this.apply(step, true)
  }

  destroy(): void {
    this.stop()
    this.h.pdf.pageEvents.removeEventListener('drawn', this.onDrawn)
    for (const ref of this.refs) this.h.app.vault.offref(ref)
    this.refs.length = 0
  }

  /** Writes what is waiting to be written, now. */
  flush(): Promise<void> {
    window.clearTimeout(this.timer)
    this.timer = 0
    const pages = [...this.dirty]
    this.dirty.clear()
    this.writing = this.writing
      .then(async () => {
        for (const index of pages) await this.store.write(index, this.pages.get(index))
      })
      .catch((e) => console.error('[Abele] the ink could not be saved', e))
    return this.writing
  }

  // ————— What the sheet over the pages asks —————

  private overlayHost(): InkOverlayHost {
    return {
      pageAt: (x, y) => this.pageAt(x, y),
      route: (e) => routePointer({ finger: this.h.model.ink.finger, penDown: this.penDown }, e),
      brush: () => inkBrush(this.h.model.ink),
      pen: (down) => {
        this.penDown = down
        // The first touch of a pen: from now on a finger moves the pages, and the palm is ignored.
        if (down && !this.penSeen) {
          this.penSeen = true
          this.h.model.ink.finger = false
        }
      },
      commit: (index, stroke) => this.add(index, stroke),
      eraseStart: () => this.erased.clear(),
      eraseAt: (index, x, y, radius) => this.eraseAt(index, x, y, radius),
      eraseEnd: () => {
        for (const step of this.erased.values()) this.history.push(step)
        this.erased.clear()
        this.sync()
      },
      pan: (dx, dy) => {
        const renderer = this.h.engine.renderer as unknown as HTMLElement & {
          panBy?: (dx: number, dy: number) => void
        }
        if (renderer?.panBy) {
          if (dx || dy) renderer.panBy(dx, dy)
          return true
        }
        // A page turned one at a time, zoomed past the screen: moved about within itself; still
        // turned by a swipe while it is no wider than the screen, and by the wheel at its end.
        if (!renderer || !zoomedPast(renderer)) return false
        const was = renderer.scrollLeft + renderer.scrollTop
        if (dx || dy) renderer.scrollBy({ left: dx, top: dy, behavior: 'instant' })
        return zoomedPast(renderer, true) || renderer.scrollLeft + renderer.scrollTop !== was
      },
      turn: (way) => void (way > 0 ? this.h.engine.next() : this.h.engine.prev()),
      zoom: (way) => this.h.zoom(way),
      pinch: () => this.h.zoomer?.()?.pinch ?? null,
      wheelZoom: (e) => {
        const zoomer = this.h.zoomer?.()
        zoomer?.wheel(e, { x: e.clientX, y: e.clientY })
        return !!zoomer
      },
    }
  }

  /** The page frames showing, with the page each is. */
  private contents(): { doc: Document; index: number }[] {
    const renderer = this.h.engine.renderer as unknown as {
      getContents?(): { doc: Document | null; index?: number }[]
    }
    const out: { doc: Document; index: number }[] = []
    for (const c of renderer?.getContents?.() ?? []) {
      if (!c.doc) continue
      const index = c.index ?? this.docIndex.get(c.doc)
      if (typeof index === 'number') out.push({ doc: c.doc, index })
    }
    return out
  }

  private pageAt(x: number, y: number): InkPageHit | null {
    for (const { doc, index } of this.contents()) {
      const frame = doc.defaultView?.frameElement
      const size = pageSizeOf(doc)
      if (!frame || !size) continue
      const rect = frame.getBoundingClientRect()
      if (!rect.width || !rect.height) continue
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
        return { index, rect, width: size.width, height: size.height }
    }
    return null
  }

  private add(index: number, stroke: InkStroke): void {
    const page = this.pageFor(index)
    if (!page) return
    page.strokes.push(stroke)
    this.history.push({ index, added: [stroke], removed: [] })
    this.changed(index)
  }

  private eraseAt(index: number, x: number, y: number, radius: number): void {
    const page = this.pages.get(index)
    if (!page) return
    let hit = false
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      const stroke = page.strokes[i]
      if (!hitStroke(stroke, x, y, radius)) continue
      page.strokes.splice(i, 1)
      const step = this.erased.get(index) ?? { index, added: [], removed: [] }
      step.removed.push({ stroke, at: i })
      this.erased.set(index, step)
      hit = true
    }
    if (hit) this.changed(index)
  }

  /** A step taken back (`forward` false) or taken again. */
  private apply(step: InkStep, forward: boolean): void {
    const page = this.pageFor(step.index)
    if (!page) return
    const drop = (s: InkStroke) => {
      const i = page.strokes.indexOf(s)
      if (i >= 0) page.strokes.splice(i, 1)
    }
    if (forward) {
      for (const { stroke } of step.removed) drop(stroke)
      page.strokes.push(...step.added)
    } else {
      for (const s of step.added) drop(s)
      // Put back where each stood, the one nearest the start first.
      for (const { stroke, at } of [...step.removed].sort((a, b) => a.at - b.at))
        page.strokes.splice(Math.min(at, page.strokes.length), 0, stroke)
    }
    this.changed(step.index)
  }

  /** A page's ink, made empty the first time it is drawn on, at the page's size. */
  private pageFor(index: number): InkPage | null {
    const known = this.pages.get(index)
    if (known) return known
    const doc = this.contents().find((c) => c.index === index)?.doc
    const size = doc ? pageSizeOf(doc) : null
    if (!size) return null
    const page: InkPage = { ...size, strokes: [] }
    this.pages.set(index, page)
    return page
  }

  private changed(index: number): void {
    this.redraw(index)
    this.dirty.add(index)
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout((): void => void this.flush(), WRITE_AFTER)
    this.sync()
  }

  private redraw(index: number): void {
    for (const c of this.contents()) if (c.index === index) drawInk(c.doc, this.pages.get(index))
  }

  private sync(): void {
    this.h.model.ink.canUndo = this.history.canUndo
    this.h.model.ink.canRedo = this.history.canRedo
  }

  /** A file in the vault changed: another device's ink for a page arrives. */
  private async fileChanged(path: string): Promise<void> {
    const index = this.store.pageOf(path)
    if (index === null || this.dirty.has(index)) return
    const page = await this.store.changed(path)
    if (page === undefined) return
    if (page) this.pages.set(index, page)
    else this.pages.delete(index)
    // What undo holds names strokes that are no longer there.
    this.history.clear()
    this.sync()
    this.redraw(index)
  }
}

/** The ink of the PDF a book tab shows, drawn on its pages as they come. */
export function inkFor(
  view: {
    app: App
    model: BookModel
    reading: { where(): NotesPlace } | null
    zoom(way: 'in' | 'out'): void
    pdfZoom?: PdfZoom | null
  },
  file: TFile,
  engine: FoliateView,
  book: unknown,
  stage: () => HTMLElement | null
): PdfInk {
  return new PdfInk({
    app: view.app,
    file,
    engine,
    model: view.model,
    pdf: book as PdfBookExtras,
    stage,
    where: () =>
      view.reading?.where() ?? {
        title: '',
        author: '',
        target: { to: 'book', path: '', template: '', alsoIn: [] },
      },
    zoom: (way) => view.zoom(way),
    zoomer: () => view.pdfZoom ?? null,
  })
}
