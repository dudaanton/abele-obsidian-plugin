/**
 * Where the bar for words on the page stands: at the foot of the page, or at its head when the
 * words are in the lower part of it, so the bar never covers what it is about.
 *
 * The bar stands over the page rather than taking room from it — taking room made the engine lay
 * the page out anew, which moved the words under a selection being made (1.37) — so on the foot
 * of the page it covered the last lines, and those could not be selected (1.38, from the phone).
 */

/** Below this share of the page's height, words send the bar to the head of the page. */
export const LOWER_PART = 0.55

/** The lowest point, in the window, of the part of a range that is on screen; null if none is. */
export function bottomOnScreen(range: Range, stage: DOMRect): number | null {
  const frame =
    range.startContainer.ownerDocument?.defaultView?.frameElement?.getBoundingClientRect()
  const dx = frame?.left ?? 0
  const dy = frame?.top ?? 0
  let bottom: number | null = null
  for (const r of Array.from(range.getClientRects())) {
    const left = r.left + dx
    if (!r.width || left + r.width < stage.left || left > stage.right) continue
    bottom = Math.max(bottom ?? -Infinity, r.bottom + dy)
  }
  return bottom
}

/** Whether the bar goes to the head of the page for words whose lowest line ends at `y`. */
export function barAtTop(y: number | null, stage: DOMRect): boolean {
  if (y === null || !stage.height) return false
  return y > stage.top + stage.height * LOWER_PART
}
