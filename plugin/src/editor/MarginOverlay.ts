import type { EditorView } from '@codemirror/view'

/**
 * The margin column beside the text, shared by everything that hangs off a position in the
 * document: footnote sidenotes today, comment cards from phase 2. One layer per editor view,
 * one stack, so two entries anchored a word apart never draw on top of each other.
 *
 * The provider owns what goes in an entry — its element, its Vue teleport target, its
 * lifetime. The overlay owns only where it sits and whether it is shown. It was written for
 * two providers, footnotes and comment cards; the cards are gone and what is left is one list.
 */
export interface MarginEntry {
  /** Unique; the provider uses `genid()`. */
  id: string
  /** Document position the entry aligns with. */
  anchorPos: number
  /** The container Vue teleports into; the overlay owns its position. */
  el: HTMLElement
}

/** px of right-hand margin below which the overlay reports no room and hides every entry. */
export const MARGIN_MIN_SPACE = 200

/** px left between one entry's bottom and the next entry's top. */
export const SIDENOTE_GAP = 4

export interface StackItem {
  id: string
  anchorPos: number
  /** Top of the anchor in scroller coordinates, or null when the anchor is out of view. */
  top: number | null
  height: number
}

export interface StackOptions {
  gap?: number
}

export interface StackPlacement {
  id: string
  /** Where the entry goes, or null when it is hidden. */
  top: number | null
}

/**
 * Where each entry ends up: at its anchor, or pushed down far enough to clear the entry above
 * it. Kept free of the DOM and of CodeMirror so it can be tested without a layout engine —
 * measuring `top` and `height` is the caller's job.
 */
export function stackEntries(items: StackItem[], options: StackOptions = {}): StackPlacement[] {
  const { gap = SIDENOTE_GAP } = options
  const sorted = [...items].sort((a, b) => a.anchorPos - b.anchorPos)
  const placements: StackPlacement[] = []
  let lastBottom = -Infinity

  for (const item of sorted) {
    if (item.top === null) {
      placements.push({ id: item.id, top: null })
      continue
    }
    const top = Math.max(item.top, lastBottom + gap)
    placements.push({ id: item.id, top })
    lastBottom = top + item.height
  }

  return placements
}

/** Sidenote column geometry, unchanged from what footnotes have always used. */
const SIDENOTE_MIN_WIDTH = 180
const SIDENOTE_MAX_WIDTH = 300
/** Right-hand breathing space kept clear of the scrollbar. */
const SIDENOTE_RIGHT_INSET = 16
/** Gap between the text column and the sidenote column. */
const SIDENOTE_LEFT_OFFSET = 8

/**
 * The provider owns the block class on its container; the overlay only ever toggles the
 * modifier that takes it out of the column.
 */
const HIDDEN_CLASS = 'abele-footnote-widget-container_hidden'

const overlays = new WeakMap<EditorView, MarginOverlay>()

export class MarginOverlay {
  private readonly view: EditorView
  private readonly layer: HTMLElement
  private entries: MarginEntry[] = []
  private readonly roomListeners = new Set<(hasRoom: boolean) => void>()
  private room = false
  private destroyed = false

  constructor(view: EditorView) {
    this.view = view
    // The layer belongs to the window the editor is in, which is not the main one in a popout.
    this.layer = view.scrollDOM.ownerDocument.win.createDiv()
    // `abele-footnotes-overlay` is kept on the element so anything that addressed the layer by
    // name — a user's CSS snippet, an e2e selector — still matches.
    this.layer.classList.add('abele-margin-overlay', 'abele-footnotes-overlay')
    view.scrollDOM.appendChild(this.layer)
  }

  /** Replace the entries in the column. */
  setEntries(entries: MarginEntry[]): void {
    if (this.destroyed) return

    const kept = new Set(entries.map((entry) => entry.id))
    for (const previous of this.entries) {
      if (!kept.has(previous.id)) previous.el.remove()
    }
    for (const entry of entries) {
      if (entry.el.parentElement !== this.layer) this.layer.appendChild(entry.el)
    }

    this.entries = [...entries]
  }

  /** Re-measure and re-stack. Called by providers after doc/viewport/geometry changes. */
  position(): void {
    if (this.destroyed) return

    const contentRect = this.view.contentDOM.getBoundingClientRect()
    const scrollerRect = this.view.scrollDOM.getBoundingClientRect()
    const rightSpace = scrollerRect.right - contentRect.right

    this.setRoom(rightSpace >= MARGIN_MIN_SPACE)

    const entries = this.entries
    if (entries.length === 0) return

    if (!this.room) {
      for (const entry of entries) entry.el.toggleClass(HIDDEN_CLASS, true)
      return
    }

    const width = Math.min(
      SIDENOTE_MAX_WIDTH,
      Math.max(SIDENOTE_MIN_WIDTH, rightSpace - SIDENOTE_RIGHT_INSET)
    )
    const left = contentRect.right - scrollerRect.left + SIDENOTE_LEFT_OFFSET

    // Width and visibility first, for every entry: a hidden entry is `display: none` and
    // measures 0, and an entry's height follows from the width it is given — so both have to be
    // settled before anything is measured. The stacking loop below puts `_hidden` back on the
    // entries whose anchor turns out to be off screen.
    for (const entry of entries) {
      entry.el.toggleClass(HIDDEN_CLASS, false)
      entry.el.style.width = `${width}px`
      entry.el.style.left = `${left}px`
    }

    const placements = stackEntries(
      entries.map((entry) => ({
        id: entry.id,
        anchorPos: entry.anchorPos,
        top: this.topOf(entry.anchorPos, scrollerRect.top),
        height: entry.el.offsetHeight,
      })),
    )

    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    for (const placement of placements) {
      const entry = byId.get(placement.id)
      if (!entry) continue
      entry.el.toggleClass(HIDDEN_CLASS, placement.top === null)
      if (placement.top !== null) entry.el.style.top = `${placement.top}px`
    }
  }

  /** True when the right margin is at least MARGIN_MIN_SPACE wide. Reactive via `onRoomChange`. */
  hasRoom(): boolean {
    return this.room
  }

  onRoomChange(cb: (hasRoom: boolean) => void): () => void {
    this.roomListeners.add(cb)
    return () => {
      this.roomListeners.delete(cb)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    for (const entry of this.entries) entry.el.remove()
    this.entries = []
    this.roomListeners.clear()
    this.layer.remove()
    // Only the overlay the map points at may evict itself: a second one built on the same view
    // going away must not take the registered one with it.
    if (overlays.get(this.view) === this) overlays.delete(this.view)
  }

  /** Top of a document position in scroller coordinates, or null when it is out of view. */
  private topOf(pos: number, scrollerTop: number): number | null {
    const coords = this.view.coordsAtPos(pos)
    if (!coords) return null
    return coords.top - scrollerTop + this.view.scrollDOM.scrollTop
  }

  private setRoom(room: boolean): void {
    if (room === this.room) return
    this.room = room
    for (const cb of this.roomListeners) cb(room)
  }
}

/**
 * The overlay this view already has, or nothing.
 *
 * A teardown path must ask through this rather than through `marginOverlayFor`: the first
 * provider to be destroyed takes the layer with it and evicts the map entry, so the second one
 * asking to create would hang a fresh layer on a scroller that is going away.
 */
export function marginOverlayIfAny(view: EditorView): MarginOverlay | undefined {
  return overlays.get(view)
}

/** One overlay per view, created on first use, destroyed with the view. */
export function marginOverlayFor(view: EditorView): MarginOverlay {
  let overlay = overlays.get(view)
  if (!overlay) {
    overlay = new MarginOverlay(view)
    overlays.set(view, overlay)
  }
  return overlay
}
