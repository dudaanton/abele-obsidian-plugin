/**
 * Where a small bar offering something to do with selected words goes, clear of what the system
 * draws around them.
 *
 * With a mouse, just above the words, or below where there is no room. With a finger, below
 * them: the end handle hangs under the last line, so the bar keeps a finger's width off it, and
 * the system's own menu (Copy, Look Up…) sits above. Where there is no room below — words at
 * the bottom of what is seen — it goes above instead, over that menu's height as well.
 */
export interface Box {
  top: number
  bottom: number
  left: number
}

/** Below the words: under the end handle's knob, with a little air. */
export const HANDLE_CLEARANCE = 36
/** Above the words: over the system's menu and the start handle's knob. */
export const CALLOUT_CLEARANCE = 64
const GAP = 6

export function placeSelectionBar(
  words: Box,
  bar: { width: number; height: number },
  frame: { width: number; top?: number; bottom?: number },
  touch: boolean,
  options: { calloutBelow?: boolean } = {}
): { top: number; left: number } {
  const roof = frame.top ?? 0
  const floor = frame.bottom ?? Infinity
  // Near the top of an iOS chat the native menu can move under the selection instead
  // of above it. Reserve both its height and the handle when that host opts in.
  const below = words.bottom + (touch ? HANDLE_CLEARANCE + (options.calloutBelow ? CALLOUT_CLEARANCE : 0) : GAP)
  const above = words.top - bar.height - (touch ? CALLOUT_CLEARANCE : GAP)
  const fitsBelow = below + bar.height <= floor
  const fitsAbove = above >= roof

  let top: number
  if (touch) top = fitsBelow || !fitsAbove ? below : above
  else top = fitsAbove ? above : below
  // Neither fits — the words fill what is seen: at its bottom edge, where a thumb reaches.
  if (!fitsBelow && !fitsAbove && Number.isFinite(floor)) top = floor - bar.height - GAP
  const left = Math.min(Math.max(0, words.left), Math.max(0, frame.width - bar.width))
  return { top, left }
}
