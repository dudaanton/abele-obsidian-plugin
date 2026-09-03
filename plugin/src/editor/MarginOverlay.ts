/**
 * The margin column beside the text, shared by everything that hangs off a position in the
 * document: footnote sidenotes today, comment cards from phase 2. One layer per editor view,
 * one stack, so two entries anchored a word apart never draw on top of each other.
 *
 * Providers own what goes in an entry — its element, its Vue teleport target, its lifetime —
 * and register it here by kind. The overlay owns only where it sits and whether it is shown.
 */
export type MarginEntryKind = 'footnote' | 'comment'

export interface MarginEntry {
  /** Unique across kinds; providers use `genid()`. */
  id: string
  kind: MarginEntryKind
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
export function stackEntries(items: StackItem[], gap: number = SIDENOTE_GAP): StackPlacement[] {
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
