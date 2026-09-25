/**
 * Selecting words on a page turned one at a time, without the page turning under the selection —
 * and turning it on purpose, the selection carried over, when the selection is held at the edge.
 *
 * `PageGesture` tells a clean tap from anything to do with a selection. A tap turns the page only
 * when nothing was selected as it began, no selection or highlight bar was open, it did not change
 * the selection, and it was not a long press. Anything else — a long press that selects, a tap on
 * the selection or a highlight, a tap beside an open bar to close it — leaves the page where it is.
 *
 * `SelectionPager` keeps a selection to the pages it has been shown on and carries it over pages
 * on purpose — see its own comment. A selection is one range in one document: it stays within the
 * chapter (and within a page of a PDF, where each page is a document of its own), and says so
 * when it reaches the end.
 */
import { Notice } from 'obsidian'

/** How long a touch may be held and still be a tap. */
export const LONG_PRESS_MS = 450
/** How long a selection is held at an edge before the page turns. */
export const EDGE_HOLD_MS = 600
/** How long each further page takes while the selection stays at the edge. */
export const REPEAT_MS = 1000

const selected = (doc: Document): boolean => {
  const sel = doc.getSelection()
  return !!sel && sel.rangeCount > 0 && !sel.isCollapsed
}

/** What the finger or the mouse on one page is doing, and whether it may turn the page. */
export class PageGesture {
  private down = false
  private downAt = 0
  private touch = false
  /** A selection, or a bar the host shows for one, was there when the gesture began. */
  private involved = false
  /** The gesture made or changed a selection. */
  private changed = false
  private held = false
  /** When the last touch ended: the mouse events a touch is followed by are not a gesture. */
  private touchEnded = 0

  constructor(
    private readonly doc: Document,
    /** Whether a selection's or a highlight's bar is open. */
    private readonly barOpen: () => boolean
  ) {
    const begin = (touch: boolean) => {
      // A touch sends both touchstart and pointerdown: the first one begins the gesture.
      if (this.down && Date.now() - this.downAt < 80) return
      this.down = true
      this.downAt = Date.now()
      this.touch = touch
      this.involved = selected(doc) || barOpen()
      this.changed = false
      this.held = false
    }
    const end = () => {
      if (this.down && this.touch && Date.now() - this.downAt > LONG_PRESS_MS) this.held = true
      if (this.touch) this.touchEnded = Date.now()
      this.down = false
    }
    doc.addEventListener('touchstart', () => begin(true), { capture: true, passive: true })
    doc.addEventListener('pointerdown', (e) => begin(e.pointerType !== 'mouse'), true)
    doc.addEventListener(
      'mousedown',
      () => {
        if (Date.now() - this.touchEnded > 1000) begin(false)
      },
      true
    )
    doc.addEventListener('touchend', end, true)
    doc.addEventListener('pointerup', end, true)
    doc.addEventListener(
      'pointercancel',
      () => {
        // The platform took the touch over — a long press selecting, a scroll.
        if (this.down) this.held = true
      },
      true
    )
    // A caret put down by a tap is not a selection; words selected are.
    doc.addEventListener('selectionchange', () => {
      if (this.down && selected(doc)) this.changed = true
    })
  }

  /** Whether the gesture had anything to do with a selection or a bar. */
  get selecting(): boolean {
    return this.involved || this.changed || this.held || selected(this.doc)
  }

  /** A tap that may turn the page. */
  get cleanTap(): boolean {
    return !this.selecting
  }

  /** Whether a gesture is going on now. */
  get active(): boolean {
    return this.down
  }
}

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
}

type Point = [Node, number]

const before = (a: Point, b: Point, doc: Document): boolean => {
  const r = doc.createRange()
  r.setStart(a[0], a[1])
  return r.comparePoint(b[0], b[1]) > 0
}

/** Every word of a range, each as a range of its own, in order. */
function wordsIn(range: Range): Range[] {
  const doc = range.startContainer.ownerDocument
  if (!doc) return []
  const root = range.commonAncestorContainer
  const walker = doc.createTreeWalker(root.nodeType === 3 ? root.parentNode : root, 4)
  const out: Range[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue
    const t = n as Text
    const from = t === range.startContainer ? range.startOffset : 0
    const to = t === range.endContainer ? range.endOffset : t.length
    for (const m of (t.nodeValue ?? '').slice(from, to).matchAll(/\S+/g)) {
      const w = doc.createRange()
      w.setStart(t, from + (m.index ?? 0))
      w.setEnd(t, from + (m.index ?? 0) + m[0].length)
      out.push(w)
    }
  }
  return out
}

/**
 * A selection on pages turned one at a time: kept to the pages it has been shown on, and carried
 * onto the next or last page on purpose.
 *
 * What it learnt from iOS itself (the lab in `tests/ios/`): while a selection handle is dragged,
 * WebKit tells the page only that a finger came down — no move and no lift — so where the finger
 * is cannot be known; and a handle dragged below the text of a page selects to the end of the
 * chapter, since the pages are columns of one long page. 1.37 guessed the finger from the end of
 * the selection and turned the page, over and over, while WebKit grew the selection to the end
 * of the chapter: the page jumped, and selecting over pages was a matter of luck.
 *
 * So: the selection never reaches past the pages it has been shown on — a handle dragged off the
 * text stops at the page's last word; `extend` turns the page and carries the selection's end on
 * to the first word of the next page (or its start back to the last word of the page before),
 * with the handle there to drag on; and where a pointer's moves do reach the page (a mouse,
 * Android), holding the selection at the edge does the same.
 */
export class SelectionPager {
  private down = false
  private x: number | null = null
  /** Which way the selection is being held, and since when. */
  private holding: { dir: 1 | -1; since: number } | null = null
  private timer = 0
  private told = false
  /** The part of the chapter the selection may cover: the pages it has been shown on. */
  private span: { start: Point; end: Point } | null = null
  /** Set while the selection is being changed here, so its own change is not clamped. */
  private moving = false

  constructor(
    private readonly doc: Document,
    private readonly host: PagerHost,
    private readonly notify: (message: string) => void = (m) => new Notice(m)
  ) {
    const at = (e: MouseEvent | Touch) => {
      const frame = doc.defaultView?.frameElement
      const stage = host.stage()
      if (!stage) return
      this.x =
        e.clientX + (frame?.getBoundingClientRect().left ?? 0) - stage.getBoundingClientRect().left
      this.check()
    }
    const press = () => {
      this.down = true
      this.x = null
      this.holding = null
      this.told = false
    }
    const release = () => {
      this.down = false
      this.x = null
      this.holding = null
    }
    doc.addEventListener('pointerdown', press, true)
    doc.addEventListener('mousedown', press, true)
    doc.addEventListener('touchstart', press, { capture: true, passive: true })
    doc.addEventListener('pointermove', (e) => this.down && at(e), true)
    doc.addEventListener('mousemove', (e) => this.down && e.buttons && at(e), true)
    doc.addEventListener(
      'touchmove',
      (e) => {
        const t = e.touches[0]
        if (t && e.touches.length === 1) {
          this.down = true
          at(t)
        }
      },
      { capture: true, passive: true }
    )
    doc.addEventListener('pointerup', release, true)
    doc.addEventListener('mouseup', release, true)
    doc.addEventListener('touchend', release, true)
    doc.addEventListener('selectionchange', () => this.selectionChanged())
    // Every page shown while words are selected joins what the selection may cover.
    host.renderer()?.addEventListener('relocate', () => this.grow())
  }

  private selection(): Range | null {
    const sel = this.doc.getSelection()
    return sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null
  }

  private paged(): boolean {
    const r = this.host.renderer()
    return !!r && !r.scrolled && !this.host.fixed()
  }

  /**
   * The words on screen, first and last, to the word. The engine's own account of what is on
   * screen goes by whole text nodes where a paragraph runs over two pages — in Chromium it took a
   * paragraph begun at the foot of one page for all on it — so each word of it is looked at.
   */
  private onScreen(): Range[] {
    const v = this.host.visible()
    if (!v || v.startContainer.ownerDocument !== this.doc) return []
    const words = wordsIn(v)
    const shown = (w: Range) => this.shown(w)
    const inside = words.filter(shown)
    return inside.length ? inside : words
  }

  /** Whether a word stands wholly inside the page on screen. */
  private shown(w: Range): boolean {
    // The page's own box: the stage can be taller than what the engine lays a page out in.
    const box = this.host.renderer() as unknown as HTMLElement | null
    const stage = (box?.getBoundingClientRect ? box : this.host.stage())?.getBoundingClientRect()
    const frame = this.doc.defaultView?.frameElement?.getBoundingClientRect()
    if (!stage) return true
    // Wholly inside: the line ends of the pages either side reach into the page's margins.
    const r = w.getClientRects()[0] ?? w.getBoundingClientRect()
    const left = r.left + (frame?.left ?? 0)
    const top = r.top + (frame?.top ?? 0)
    return (
      left >= stage.left - 1 &&
      left + r.width <= stage.right + 1 &&
      top >= stage.top - 1 &&
      top + r.height <= stage.bottom + 1
    )
  }

  /**
   * The first word on screen past a point (or, `-1`, the last one before it), walking the
   * chapter's text from there. Found by where the words are, not by the engine's account of the
   * page, which can take in a paragraph of the page before.
   */
  private shownFrom(from: Point, dir: 1 | -1): Range | null {
    const walker = this.doc.createTreeWalker(this.doc.body ?? this.doc.documentElement, 4)
    const texts: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text)
    const probe = this.doc.createRange()
    const words = (t: Text) =>
      Array.from((t.nodeValue ?? '').matchAll(/\S+/g)).map((m) => {
        const w = this.doc.createRange()
        w.setStart(t, m.index ?? 0)
        w.setEnd(t, (m.index ?? 0) + m[0].length)
        return w
      })
    const order = dir > 0 ? texts : [...texts].reverse()
    let seen = 0
    for (const t of order) {
      probe.selectNodeContents(t)
      // Text wholly before the point (after it, going back) is passed over at once.
      if (
        dir > 0
          ? probe.comparePoint(from[0], from[1]) > 0
          : probe.comparePoint(from[0], from[1]) < 0
      )
        continue
      const list = dir > 0 ? words(t) : words(t).reverse()
      for (const w of list) {
        const past =
          dir > 0
            ? before(from, [w.endContainer, w.endOffset], this.doc)
            : before([w.startContainer, w.startOffset], from, this.doc)
        if (!past) continue
        if (this.shown(w)) return w
        if (++seen > 4000) return null
      }
    }
    return null
  }

  /** The page on screen as the stretch of the chapter the selection may cover. */
  private page(): { start: Point; end: Point } | null {
    const on = this.onScreen()
    if (!on.length) return null
    const first = on[0]
    const last = on[on.length - 1]
    return {
      start: [first.startContainer, first.startOffset],
      end: [last.endContainer, last.endOffset],
    }
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
      this.span = null
      this.holding = null
      return
    }
    if (!this.span) this.span = this.page()
    if (this.span && !this.moving && this.paged()) this.clamp(range)
    this.check()
  }

  private clamp(range: Range): void {
    const span = this.span
    const sel = this.doc.getSelection()
    if (!span || !sel) return
    const start: Point = [range.startContainer, range.startOffset]
    const end: Point = [range.endContainer, range.endOffset]
    const newStart = before(start, span.start, this.doc) ? span.start : start
    const newEnd = before(span.end, end, this.doc) ? span.end : end
    if (newStart === start && newEnd === end) return
    // The way it was made, kept: the end the finger holds stays the moving one.
    const backward = sel.anchorNode === range.endContainer && sel.anchorOffset === range.endOffset
    this.set(backward ? newEnd : newStart, backward ? newStart : newEnd)
  }

  private set(anchor: Point, focus: Point): void {
    this.moving = true
    this.doc.getSelection()?.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1])
    // The change is heard a moment later, as its own `selectionchange`.
    window.setTimeout(() => (this.moving = false), 0)
  }

  private edge(): number {
    const width = this.host.stage()?.clientWidth ?? 0
    return Math.max(24, width * 0.06)
  }

  /** Which way a pointer holds the selection against the edge now, if it does. */
  private direction(): 1 | -1 | null {
    // Only pages turn under a held pointer (a PDF's say they cannot); a scrolled chapter
    // scrolls under it by itself.
    if (!this.selection() || this.x === null || this.host.renderer()?.scrolled) return null
    const width = this.host.stage()?.clientWidth ?? 0
    if (!width) return null
    if (this.x >= width - this.edge()) return 1
    if (this.x <= this.edge()) return -1
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
    // Held by a pointer, the selection follows it onto the page by itself.
    void this.turn(holding.dir).then((turned) => {
      // Still held there: the next page follows after a longer moment, so as not to overshoot.
      if (turned) window.setTimeout(() => this.check(), REPEAT_MS - EDGE_HOLD_MS)
    })
  }

  /**
   * The selection carried onto the next page (`1`), its end moved to that page's first word, or
   * onto the page before (`-1`), its start moved to that page's last word — where its handle can
   * be taken on from. What the extend buttons beside the page do.
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

/** The pager of each page, so the extend buttons beside the page can reach the one on screen. */
const pagers = new WeakMap<Document, SelectionPager>()

export function pagerFor(doc: Document, host: PagerHost): SelectionPager {
  let pager = pagers.get(doc)
  if (!pager) {
    pager = new SelectionPager(doc, host)
    pagers.set(doc, pager)
  }
  return pager
}

/** Carries the selection on the page on screen onto the next or last page; see `extend`. */
export function extendSelection(
  docs: (Document | null | undefined)[],
  dir: 1 | -1
): Promise<boolean> {
  for (const doc of docs) {
    const pager = doc && pagers.get(doc)
    const sel = doc?.getSelection()
    if (pager && sel && !sel.isCollapsed) return pager.extend(dir)
  }
  return Promise.resolve(false)
}
