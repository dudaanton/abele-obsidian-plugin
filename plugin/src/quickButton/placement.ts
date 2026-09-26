/**
 * Where the quick button stands, as arithmetic on rectangles in the window's coordinates.
 *
 * It rests at the bottom of the screen, on its side, on top of whatever is already down there —
 * Obsidian's navigation bar, a book's line under the page, a chat's composer — so that it never
 * covers a control. Which of those is there changes from screen to screen, so the line it rests
 * on is found each time from what is actually on screen rather than written down.
 */
import type { QuickSide } from './settings'

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * The line the button rests on: the top of the highest thing in the lower half of the screen
 * that its column would overlap, or the bottom of the screen when nothing is there.
 *
 * The lower half, because the column also passes the view's header at the top of the screen,
 * which the button is never near.
 */
export function restLine(
  obstacles: Box[],
  column: { left: number; right: number },
  screenBottom: number
): number {
  let line = screenBottom
  for (const box of obstacles) {
    if (box.right - box.left <= 0 || box.bottom - box.top <= 0) continue
    if (box.right <= column.left || box.left >= column.right) continue
    if (box.top < screenBottom / 2) continue
    line = Math.min(line, box.top)
  }
  return line
}

/** The button's top: a gap above the line, raised by the lift, never above the ceiling. */
export function buttonTop(at: {
  line: number
  size: number
  gap: number
  lift: number
  ceiling: number
}): number {
  const top = at.line - at.gap - at.size - Math.max(0, at.lift)
  return Math.round(Math.max(at.ceiling, top))
}

/** The side a button let go at `x` goes to. */
export function sideFor(x: number, width: number): QuickSide {
  return x < width / 2 ? 'left' : 'right'
}

/** How far above its resting place a button let go with its top at `top` stands. */
export function liftFor(at: { top: number; line: number; size: number; gap: number }): number {
  return Math.max(0, Math.round(at.line - at.gap - at.size - at.top))
}
