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
  /** The selection as the gesture began: the anchor and focus, which a tap may let go. */
  private started: { anchor: [Node, number]; focus: [Node, number] } | null = null
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
      const sel = doc.getSelection()
      this.started =
        sel && !sel.isCollapsed && sel.anchorNode && sel.focusNode
          ? { anchor: [sel.anchorNode, sel.anchorOffset], focus: [sel.focusNode, sel.focusOffset] }
          : null
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

  /** The selection the gesture began with, if it began with one. */
  get startedWith(): { anchor: [Node, number]; focus: [Node, number] } | null {
    return this.started
  }

  /** Whether a gesture is going on now. */
  get active(): boolean {
    return this.down
  }
}
