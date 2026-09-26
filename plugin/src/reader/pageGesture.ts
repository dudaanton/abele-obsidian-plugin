/**
 * What the finger or the mouse on one page of a book is doing, and whether it may turn the page.
 *
 * A tap turns the page only when nothing was selected as it began, no selection or highlight bar
 * was open, it did not change the selection, and it was not a long press. Anything else — a long
 * press that selects, a tap on the selection or a highlight, a tap beside an open bar to close it
 * — leaves the page where it is, with one exception the reader makes itself: a tap on the very
 * edge of the page while words are selected turns it and carries the selection on
 * (`SelectionPager.tapTurn`), for which the gesture keeps the selection it began with, since the
 * platform lets it go on the tap.
 */
/** How long a touch may be held and still be a tap. */
export const LONG_PRESS_MS = 450

/**
 * How far, in CSS pixels, a press may wander and still be a click rather than a drag: a mouse
 * barely moves on a click, a finger rolls a little on a tap.
 */
export const MOUSE_SLOP = 5
export const TOUCH_SLOP = 12

export const selected = (doc: Document): boolean => {
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
  /** Where the gesture began, and whether it has since wandered further than a click would. */
  private from: { x: number; y: number } | null = null
  private moved = false
  /** The selection as the gesture began: the anchor and focus, which a tap may let go. */
  private started: { anchor: [Node, number]; focus: [Node, number] } | null = null
  /** When the last touch ended: the mouse events a touch is followed by are not a gesture. */
  private touchEnded = 0

  constructor(
    private readonly doc: Document,
    /** Whether a selection's or a highlight's bar is open. */
    private readonly barOpen: () => boolean
  ) {
    const begin = (touch: boolean, at: { x: number; y: number } | null) => {
      // A touch sends both touchstart and pointerdown: the first one begins the gesture.
      if (this.down && Date.now() - this.downAt < 80) return
      this.down = true
      this.downAt = Date.now()
      this.touch = touch
      this.involved = selected(doc) || barOpen()
      const sel = doc.getSelection()
      this.started =
        sel && !sel.isCollapsed && sel.anchorNode && sel.focusNode
          ? { anchor: [sel.anchorNode, sel.anchorOffset], focus: [sel.focusNode, sel.focusOffset] }
          : null
      this.changed = false
      this.held = false
      this.from = at
      this.moved = false
    }
    const wander = (x: number, y: number) => {
      if (!this.down || this.moved) return
      if (!this.from) {
        this.from = { x, y }
        return
      }
      const slop = this.touch ? TOUCH_SLOP : MOUSE_SLOP
      if (Math.hypot(x - this.from.x, y - this.from.y) > slop) this.moved = true
    }
    const end = () => {
      if (this.down && this.touch && Date.now() - this.downAt > LONG_PRESS_MS) this.held = true
      if (this.touch) this.touchEnded = Date.now()
      this.down = false
    }
    const pointAt = (e: { clientX: number; clientY: number } | undefined) =>
      e && Number.isFinite(e.clientX) ? { x: e.clientX, y: e.clientY } : null
    doc.addEventListener('touchstart', (e) => begin(true, pointAt(e.touches?.[0])), {
      capture: true,
      passive: true,
    })
    doc.addEventListener('pointerdown', (e) => begin(e.pointerType !== 'mouse', pointAt(e)), true)
    doc.addEventListener(
      'mousedown',
      (e) => {
        if (Date.now() - this.touchEnded > 1000) begin(false, pointAt(e))
      },
      true
    )
    // A drag is told from a click by how far it went, and by whether it selected anything.
    doc.addEventListener('pointermove', (e) => wander(e.clientX, e.clientY), true)
    doc.addEventListener(
      'touchmove',
      (e) => {
        const t = e.touches?.[0]
        if (t) wander(t.clientX, t.clientY)
      },
      { capture: true, passive: true }
    )
    doc.addEventListener('touchend', end, true)
    doc.addEventListener(
      'pointerup',
      (e) => {
        wander(e.clientX, e.clientY)
        end()
      },
      true
    )
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

  /**
   * The gesture was a drag rather than a click: it went further than a click wanders, or it made
   * or changed a selection — which is how a mouse selecting words ends, wherever it is let go.
   */
  get dragged(): boolean {
    return this.moved || this.changed
  }

  /** A tap that may turn the page. */
  get cleanTap(): boolean {
    return !this.selecting && !this.dragged
  }

  /** The selection the gesture began with, if it began with one. */
  get startedWith(): { anchor: [Node, number]; focus: [Node, number] } | null {
    return this.started
  }

  /** Whether a gesture is going on now. */
  get active(): boolean {
    return this.down
  }
}
