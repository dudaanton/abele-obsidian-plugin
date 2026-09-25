/**
 * Selecting words on pages turned one at a time: the selection kept to the pages it has been shown
 * on, carried over pages on purpose, and the bars kept out of the way while it is being made —
 * see `SelectionPager`. A selection is one range in one document: it stays within the chapter
 * (and within a page of a PDF, where each page is a document of its own), and says so when it
 * reaches the end. What a tap does is `pageGesture.ts`.
 */
import { Notice } from 'obsidian'
import { before, pageSpan, wordFrom, wordShown, type Point } from './pageWords'
import { SelectionQuiet } from './selectionQuiet'

export { QUIET_MS } from './selectionQuiet'

/** How long a selection is held at an edge before the page turns. */
export const EDGE_HOLD_MS = 600
/** How long each further page takes while the selection stays at the edge. */
export const REPEAT_MS = 1000
/** How much longer the bar stays hidden after a held selection has turned the page. */
export const AFTER_TURN_MS = 1000
/** The share of the page's width, either side, where a tap with words selected turns the page. */
export const TAP_EDGE = 0.15

interface Renderer extends EventTarget {
  page?: number
  pages?: number
  scrolled?: boolean
  /** In a scrolled chapter: where the screen starts and ends, and how long the chapter is. */
  start?: number
  end?: number
  viewSize?: number
  next?: () => Promise<void>
  prev?: () => Promise<void>
}

export interface PagerHost {
  renderer(): Renderer | null
  stage(): HTMLElement | null
  /** Pages of a fixed size, each a document of its own. */
  fixed(): boolean
  /** The range on screen, as the reader last reported it. */
  visible(): Range | null
  /** Words are being selected or a selection is being changed (`true`), or it has been made. */
  adjusting?(on: boolean): void
  /** The page moved under the selection: whatever is placed by it is placed again. */
  moved?(): void
}

/**
 * A selection on pages turned one at a time: kept to the pages it has been shown on, carried onto
 * the next or last page on purpose, and its bar out of the way while it is being made.
 *
 * What it learnt from iOS itself (the lab in `tests/ios/`): while a selection handle is dragged,
 * WebKit tells the page only that a finger came down — no move and no lift — so where the finger
 * is cannot be known; and a handle dragged past a page's text selects to the end of the chapter
 * (or back to its start), since the pages are columns of one long page.
 *
 * So:
 * - The selection never reaches past the pages it has been shown on: a handle dragged off the
 *   text stops at the page's last word (or first). That stop is also the sign the finger has gone
 *   past the edge of the text: held there for a moment, the page turns and the selection's end
 *   goes on to the first word of the next page (its start back to the last word of the page
 *   before), drawn again with its handles to drag on — and again while it stays held there.
 *   Where a pointer's moves do reach the page (a mouse, Android), the pointer held at the bottom
 *   or right edge does the same, and at the top or left edge goes back.
 * - A tap on the very edge of the page while words are selected turns it the same way (`tapTurn`).
 * - While a selection is being made the host is told (`adjusting`), and hides the bars: the one
 *   at the foot of the page, flying up over the top of it as the selection neared the foot, was
 *   in the way of the finger (1.38). It is told again once the selection has rested — no change
 *   and no pointer moving — for `QUIET_MS`, and the mouse button is not down.
 */
export class SelectionPager {
  /** A pointer that reports itself is down on the page — a mouse button, a finger that moves. */
  private down = false
  private mouseDown = false
  /** Where that pointer is on the page, while it is down. */
  private x: number | null = null
  private y: number | null = null
  /** Which way the selection is being held, and since when. */
  private holding: { dir: 1 | -1; since: number } | null = null
  private timer = 0
  private told = false
  /** The part of the chapter the selection may cover: the pages it has been shown on. */
  private span: { start: Point; end: Point } | null = null
  /** Set while the selection is being changed here, so its own change is not clamped. */
  private moving = false
  /** Which end of the selection last went past the page's text and was held at its edge. */
  private stopped: 'start' | 'end' | null = null
  /** The selection as it last was, and which end of it the person moved since it was made. */
  private last: { start: Point; end: Point } | null = null
  private moved: 'start' | 'end' | null = null
  /** The selection as the reader last set it itself. */
  private mine: { anchor: Point; focus: Point } | null = null
  /** Whether the host was last told the selection is being made, and when anything last moved. */
  /**
   * Whether words are still being selected. Held at an edge counts as still at it: the bar coming
   * back there would cover the top of the page the finger is about to go on selecting from.
   */
  private readonly quiet = new SelectionQuiet(
    (on) => this.host.adjusting?.(on),
    () => this.mouseDown || !!this.holding
  )
  private readonly stop = new AbortController()

  constructor(
    private readonly doc: Document,
    private readonly host: PagerHost,
    private readonly notify: (message: string) => void = (m) => new Notice(m)
  ) {
    const at = (e: MouseEvent | Touch) => {
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
      const stage = this.pageBox()
      if (!stage) return
      this.x = e.clientX + (frame?.left ?? 0) - stage.left
      this.y = e.clientY + (frame?.top ?? 0) - stage.top
      this.active()
      this.check()
    }
    const press = (mouse: boolean) => {
      this.down = true
      if (mouse) this.mouseDown = true
      this.x = null
      this.y = null
      this.holding = null
      this.told = false
      this.active()
    }
    const release = () => {
      this.down = false
      this.mouseDown = false
      this.x = null
      this.y = null
      this.holding = null
      this.active()
    }
    const signal = this.stop.signal
    const on = { capture: true, signal }
    doc.addEventListener('pointerdown', (e) => press(e.pointerType === 'mouse'), on)
    doc.addEventListener('mousedown', () => press(true), on)
    doc.addEventListener('touchstart', () => press(false), { ...on, passive: true })
    doc.addEventListener('pointermove', (e) => this.down && at(e), on)
    doc.addEventListener('mousemove', (e) => this.down && e.buttons && at(e), on)
    doc.addEventListener(
      'touchmove',
      (e) => {
        const t = e.touches[0]
        if (t && e.touches.length === 1) {
          this.down = true
          at(t)
        }
      },
      { ...on, passive: true }
    )
    doc.addEventListener('pointerup', release, on)
    doc.addEventListener('mouseup', release, on)
    doc.addEventListener('touchend', release, on)
    doc.addEventListener('selectionchange', () => this.selectionChanged(), { signal })
    // Every page shown while words are selected joins what the selection may cover, and the
    // selection is shown again on it.
    host.renderer()?.addEventListener(
      'relocate',
      () => {
        // A chapter's page is made anew on every visit: the pager of one gone stops listening.
        if (!this.doc.defaultView) return this.dispose()
        this.grow()
        window.setTimeout(() => this.repaint(), 30)
      },
      { signal }
    )
  }

  /** Stops listening: the page is gone. */
  dispose(): void {
    this.stop.abort()
    window.clearTimeout(this.timer)
    this.quiet.dispose()
  }

  /** The page's own box: the stage can be taller than what the engine lays a page out in. */
  private pageBox(): DOMRect | null {
    const box = this.host.renderer() as unknown as HTMLElement | null
    return (box?.getBoundingClientRect ? box : this.host.stage())?.getBoundingClientRect() ?? null
  }

  /** Something moved: the selection, or a pointer while words are selected. */
  private active(): void {
    if (this.selection()) this.quiet.active()
    else this.quiet.settle(true)
  }

  private selection(): Range | null {
    const sel = this.doc.getSelection()
    return sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null
  }

  private paged(): boolean {
    const r = this.host.renderer()
    return !!r && !r.scrolled && !this.host.fixed()
  }

  /** The first word wholly on screen past a point (or, `-1`, the last one before it). */
  private shownFrom(from: Point, dir: 1 | -1): Range | null {
    return wordFrom(this.doc, from, dir, (w) => wordShown(w, this.doc, this.pageBox()))
  }

  /**
   * The page on screen, first word to last, as the stretch of the chapter the selection may
   * cover. The engine's own account goes by whole text nodes where a paragraph runs over two
   * pages — in Chromium it took a paragraph begun at the foot of one page for all on it — so
   * each word of it is looked at.
   */
  private page(): { start: Point; end: Point } | null {
    return pageSpan(this.host.visible(), this.doc, this.pageBox())
  }

  private grow(): void {
    const p = this.page()
    if (!p || !this.span || !this.selection()) return
    if (before(p.start, this.span.start, this.doc)) this.span.start = p.start
    if (before(this.span.end, p.end, this.doc)) this.span.end = p.end
  }

  /** Keeps the selection to its pages; a new selection starts with the page on screen. */
  private selectionChanged(): void {
    const range = this.selection()
    if (!range) {
      // Let go for a moment while it is drawn again: it is still the same selection.
      if (this.moving) return
      this.span = null
      this.holding = null
      this.stopped = null
      this.last = null
      this.moved = null
      this.quiet.settle(true)
      return
    }
    // A change of the reader's own — drawn again, carried over a page — is not the person's.
    // Told by the selection itself as well: the change may be heard after the flag is down.
    if (this.moving || this.isMine()) return
    // Heard again with nothing changed — the window taking focus back, say — is not a change.
    if (this.unchanged(range)) return
    this.active()
    if (!this.span) this.span = this.page()
    const wasStopped = this.stopped
    this.noteMoved(range)
    this.stopped = this.span && this.paged() ? this.clamp(range) : null
    // Still held past the same edge: the hold that began there goes on; anything else ends it.
    if (this.stopped !== wasStopped) this.holding = null
    this.check()
  }

  /** Whether the selection is still the one the reader last set itself. */
  private isMine(): boolean {
    const sel = this.doc.getSelection()
    const mine = this.mine
    if (!sel || !mine) return false
    return (
      sel.anchorNode === mine.anchor[0] &&
      sel.anchorOffset === mine.anchor[1] &&
      sel.focusNode === mine.focus[0] &&
      sel.focusOffset === mine.focus[1]
    )
  }

  /** Whether the selection is what it was when last heard. */
  private unchanged(range: Range): boolean {
    const last = this.last
    return (
      !!last &&
      last.start[0] === range.startContainer &&
      last.start[1] === range.startOffset &&
      last.end[0] === range.endContainer &&
      last.end[1] === range.endOffset
    )
  }

  /** Which end of the selection the person moved: none for one just made by a long press. */
  private noteMoved(range: Range): void {
    const now = {
      start: [range.startContainer, range.startOffset] as Point,
      end: [range.endContainer, range.endOffset] as Point,
    }
    const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1]
    if (this.last) {
      if (!same(this.last.end, now.end)) this.moved = 'end'
      else if (!same(this.last.start, now.start)) this.moved = 'start'
    }
    this.last = now
  }

  /** Keeps the selection to its pages; which end went past them and was stopped, if one did. */
  private clamp(range: Range): 'start' | 'end' | null {
    const span = this.span
    const sel = this.doc.getSelection()
    if (!span || !sel) return null
    const start: Point = [range.startContainer, range.startOffset]
    const end: Point = [range.endContainer, range.endOffset]
    const newStart = before(start, span.start, this.doc) ? span.start : start
    const newEnd = before(span.end, end, this.doc) ? span.end : end
    if (newStart === start && newEnd === end) return null
    // The way it was made, kept: the end the finger holds stays the moving one.
    const backward = sel.anchorNode === range.endContainer && sel.anchorOffset === range.endOffset
    this.set(backward ? newEnd : newStart, backward ? newStart : newEnd)
    return newEnd !== end ? 'end' : 'start'
  }

  /**
   * The selection drawn again, handles and all. WebKit keeps a selection through a page turn but
   * stops drawing it once the page has scrolled (seen in the iOS lab): turned away and back, the
   * words were selected and nothing showed it, so the next touch let them go. Setting the same
   * selection again, with the page's frame focused, brings it back.
   */
  private repaint(): void {
    const sel = this.doc.getSelection()
    if (!sel || !sel.rangeCount || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return
    const anchor: Point = [sel.anchorNode, sel.anchorOffset]
    const focus: Point = [sel.focusNode, sel.focusOffset]
    this.doc.defaultView?.focus()
    this.moving = true
    sel.removeAllRanges()
    this.set(anchor, focus)
    this.host.moved?.()
  }

  private set(anchor: Point, focus: Point): void {
    this.moving = true
    this.mine = { anchor, focus }
    this.doc.getSelection()?.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1])
    // The change is heard a moment later, as its own `selectionchange`.
    window.setTimeout(() => (this.moving = false), 0)
  }

  private edge(): number {
    const width = this.pageBox()?.width ?? 0
    return Math.max(24, width * 0.06)
  }

  /**
   * Which way the selection is held against the edge of the page now, if it is: by the pointer
   * where one reports itself — the bottom or right edge forward, the top or left back — and
   * otherwise, as under iOS's handles, by an end of the selection that went past the page's text
   * and was stopped at its edge.
   */
  private direction(): 1 | -1 | null {
    // Only pages turn under a held selection; a scrolled chapter scrolls under it by itself.
    if (!this.selection() || !this.paged()) return null
    const box = this.pageBox()
    if (this.down && this.x !== null && this.y !== null && box?.width) {
      const band = Math.max(32, box.height * 0.07)
      if (this.x >= box.width - this.edge() || this.y >= box.height - band) return 1
      if (this.x <= this.edge() || this.y <= band) return -1
      return null
    }
    if (this.stopped === 'end') return 1
    if (this.stopped === 'start') return -1
    // A handle brought down onto the page's last word — its foot — or up onto its first: under
    // iOS a finger below the text is as often taken for the last line as for past it.
    const range = this.selection()
    const page = this.page()
    if (!range || !page) return null
    if (this.moved === 'end' && !before([range.endContainer, range.endOffset], page.end, this.doc))
      return 1
    if (
      this.moved === 'start' &&
      !before(page.start, [range.startContainer, range.startOffset], this.doc)
    )
      return -1
    return null
  }

  /** Starts, keeps or drops the hold at the edge, and turns once it has lasted. */
  private check(): void {
    const dir = this.direction()
    if (!dir) {
      this.holding = null
      return
    }
    if (this.holding?.dir === dir) return
    this.holding = { dir, since: Date.now() }
    // A finger at the edge never rests quite still: the moves it makes there keep the hold. The
    // app's timer, not the page's: a page's frame runs no script, its timers included.
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.fire(), EDGE_HOLD_MS + 20)
  }

  private fire(): void {
    const holding = this.holding
    if (!holding || Date.now() - holding.since < EDGE_HOLD_MS) return
    if (this.direction() !== holding.dir) {
      this.holding = null
      return
    }
    this.holding = null
    this.stopped = null
    this.moved = null
    void this.extend(holding.dir).then((turned) => {
      // A turn is part of making the selection: the quiet that brings the bar back starts over,
      // and longer — the finger that held the page there is usually about to drag on, and iOS
      // does not say whether it is still down.
      this.active()
      this.quiet.extend(AFTER_TURN_MS)
      // Still held there: the next page follows after a longer moment, so as not to overshoot.
      // A handle under iOS says so by going past the new page's text in its turn.
      if (turned) window.setTimeout(() => this.check(), REPEAT_MS - EDGE_HOLD_MS)
    })
  }

  /**
   * The selection carried onto the next page (`1`), its end moved to that page's first word, or
   * onto the page before (`-1`), its start moved to that page's last word — where its handle can
   * be taken on from — drawn again with its handles, the page's frame focused.
   */
  async extend(dir: 1 | -1): Promise<boolean> {
    const range = this.selection()
    if (!range) return false
    const anchor: Point =
      dir > 0 ? [range.startContainer, range.startOffset] : [range.endContainer, range.endOffset]
    const moving: Point =
      dir > 0 ? [range.endContainer, range.endOffset] : [range.startContainer, range.startOffset]
    // The page the engine has turned to, once it has said so: at once for a page turned, a
    // moment after the scroll for a chapter scrolled through.
    const renderer = this.host.renderer()
    const moved = new Promise<void>((resolve) => {
      const done = () => {
        renderer?.removeEventListener('relocate', done)
        resolve()
      }
      renderer?.addEventListener('relocate', done)
      window.setTimeout(done, 800)
    })
    if (!(await this.turn(dir))) return false
    await moved
    this.grow()
    // Some of the selection already on the new page: the page is only turned to. Otherwise its
    // end goes to the first word on the page (back: its start to the last word).
    if (this.shownFrom(moving, dir > 0 ? -1 : 1)) return true
    const word = this.shownFrom(moving, dir)
    if (!word) return true
    const focus: Point =
      dir > 0 ? [word.endContainer, word.endOffset] : [word.startContainer, word.startOffset]
    // The page takes focus back from the button that was tapped: a selection in a frame without
    // focus is neither drawn nor given handles on iOS.
    this.doc.defaultView?.focus()
    this.set(anchor, focus)
    return true
  }

  /**
   * A tap on the edge of the page while words were selected: the page turns and the selection
   * goes on onto it. The platform lets a selection go on a tap, so the one the tap began with
   * is put back first.
   */
  async tapTurn(dir: 1 | -1, started: { anchor: Point; focus: Point } | null): Promise<boolean> {
    if (!this.selection() && started) this.set(started.anchor, started.focus)
    if (!this.selection()) return false
    return this.extend(dir)
  }

  /** Turns one page under the selection, within its document; says so at the end of it. */
  async turn(dir: 1 | -1): Promise<boolean> {
    const renderer = this.host.renderer()
    if (!renderer) return false
    const say = (message: string) => {
      if (this.told) return
      this.told = true
      this.notify(message)
    }
    if (this.host.fixed()) {
      say('A selection stays on its own page here: each page is separate.')
      return false
    }
    // Scrolled, a screen at a time; paged, a page — the first and last of `pages` being the
    // engine's way into the chapters either side, which a selection does not go to.
    const page = renderer.page ?? 0
    const pages = renderer.pages ?? 0
    const atEnd = renderer.scrolled
      ? (renderer.viewSize ?? 0) - (renderer.end ?? 0) <= 2
      : page >= pages - 2
    const atStart = renderer.scrolled ? (renderer.start ?? 0) <= 0 : page <= 1
    if (dir > 0 && atEnd) {
      say('The selection stops at the end of the chapter.')
      return false
    }
    if (dir < 0 && atStart) {
      say('The selection stops at the start of the chapter.')
      return false
    }
    await (dir > 0 ? renderer.next?.() : renderer.prev?.())
    return true
  }
}

/** The pager of each page, so a tap on the page can reach it. */
const pagers = new WeakMap<Document, SelectionPager>()

export function pagerFor(doc: Document, host: PagerHost): SelectionPager {
  let pager = pagers.get(doc)
  if (!pager) {
    pager = new SelectionPager(doc, host)
    pagers.set(doc, pager)
  }
  return pager
}

/** The pager already made for a page, if there is one. */
export const pagerOf = (doc: Document): SelectionPager | undefined => pagers.get(doc)
