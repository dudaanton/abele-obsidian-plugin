/**
 * Selecting words on a page turned one at a time, without the page turning under the selection —
 * and turning it on purpose, the selection carried over, when the selection is held at the edge.
 *
 * `PageGesture` tells a clean tap from anything to do with a selection. A tap turns the page only
 * when nothing was selected as it began, no selection or highlight bar was open, it did not change
 * the selection, and it was not a long press. Anything else — a long press that selects, a tap on
 * the selection or a highlight, a tap beside an open bar to close it — leaves the page where it is.
 *
 * `SelectionPager` follows a selection being made to the edge of the page, the way Apple Books
 * does. Where the pointer can be followed (a mouse, a finger on Android, a pen) the selection
 * held at the left or right edge for a moment turns the page, and goes on growing on the next
 * one. Where it cannot — iOS moves its selection handles without telling the page where the
 * finger is — the end being moved, held on the first or last word of the page, does the same.
 * A selection is one range in one document: it stays within the chapter (and within a page of a
 * PDF, where each page is a document of its own), and says so when it reaches the end.
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

interface Renderer {
  page?: number
  pages?: number
  scrolled?: boolean
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
  /** A touch screen, where the selection may move with no pointer to follow. */
  touch(): boolean
}

/** Turns the page under a selection held at its edge, the selection kept and growing. */
export class SelectionPager {
  private down = false
  private x: number | null = null
  /** Which way the selection is being held, and since when. */
  private holding: { dir: 1 | -1; since: number } | null = null
  private timer = 0
  private last: { start: [Node, number]; end: [Node, number] } | null = null
  private moving: 'start' | 'end' | null = null
  private told = false

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
  }

  private edge(): number {
    const width = this.host.stage()?.clientWidth ?? 0
    return Math.max(24, width * 0.06)
  }

  /** Which way the selection is held against the edge now, if it is. */
  private direction(): 1 | -1 | null {
    if (!selected(this.doc)) return null
    const width = this.host.stage()?.clientWidth ?? 0
    if (this.x !== null && width) {
      if (this.x >= width - this.edge()) return 1
      if (this.x <= this.edge()) return -1
      return null
    }
    // No pointer to follow: the end being moved, on the first or last word of the page.
    if (!this.host.touch() || !this.moving) return null
    return this.atPageEdge(this.moving)
  }

  private atPageEdge(which: 'start' | 'end'): 1 | -1 | null {
    const visible = this.host.visible()
    const sel = this.doc.getSelection()
    if (!visible || !sel?.rangeCount || visible.startContainer.ownerDocument !== this.doc)
      return null
    const range = sel.getRangeAt(0)
    const between = this.doc.createRange()
    try {
      if (which === 'end') {
        between.setStart(range.endContainer, range.endOffset)
        between.setEnd(visible.endContainer, visible.endOffset)
      } else {
        between.setStart(visible.startContainer, visible.startOffset)
        between.setEnd(range.startContainer, range.startOffset)
      }
    } catch {
      return null
    }
    // Past the page's end counts as at it; at most a word short of it does too.
    const words = between.collapsed
      ? []
      : (between.cloneContents().textContent ?? '').trim().split(/\s+/).filter(Boolean)
    if (words.length > 1) return null
    return which === 'end' ? 1 : -1
  }

  private selectionChanged(): void {
    const sel = this.doc.getSelection()
    if (!sel?.rangeCount || sel.isCollapsed) {
      this.last = null
      this.moving = null
      this.holding = null
      return
    }
    const r = sel.getRangeAt(0)
    const now = {
      start: [r.startContainer, r.startOffset] as [Node, number],
      end: [r.endContainer, r.endOffset] as [Node, number],
    }
    const same = (a: [Node, number], b: [Node, number]) => a[0] === b[0] && a[1] === b[1]
    // Only an end moved after the selection was made counts: words just selected by a long
    // press on the last word of a page do not turn it.
    if (this.last) {
      if (!same(this.last.end, now.end)) this.moving = 'end'
      else if (!same(this.last.start, now.start)) this.moving = 'start'
    } else this.moving = null
    this.last = now
    // With no pointer to follow, a change restarts the hold: the end has to rest at the edge.
    if (this.x === null) this.holding = null
    this.check()
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
    void this.turn(holding.dir).then((turned) => {
      // Still held there: the next page follows after a longer moment, so as not to overshoot.
      if (turned) window.setTimeout(() => this.check(), REPEAT_MS - EDGE_HOLD_MS)
    })
  }

  /** Turns one page under the selection, within its document; says so at the end of it. */
  async turn(dir: 1 | -1): Promise<boolean> {
    const renderer = this.host.renderer()
    if (!renderer || renderer.scrolled) return false
    const say = (message: string) => {
      if (this.told) return
      this.told = true
      this.notify(message)
    }
    if (this.host.fixed()) {
      say('A selection stays on its own page here: each page is separate.')
      return false
    }
    const page = renderer.page ?? 0
    const pages = renderer.pages ?? 0
    // The first and last of `pages` are the engine's way into the chapters either side.
    if (dir > 0 && page >= pages - 2) {
      say('The selection stops at the end of the chapter.')
      return false
    }
    if (dir < 0 && page <= 1) {
      say('The selection stops at the start of the chapter.')
      return false
    }
    await (dir > 0 ? renderer.next?.() : renderer.prev?.())
    return true
  }
}
