/**
 * Whether a finger's movement was a swipe to turn a page, and which way it went.
 */
export interface TouchPoint {
  x: number
  y: number
  /** ms */
  t: number
}

/** Mostly sideways, far enough, and quick: `left` when the finger moved to the left. */
export function swipeDirection(from: TouchPoint, to: TouchPoint): 'left' | 'right' | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dt = to.t - from.t
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5 || dt > 800) return null
  return dx < 0 ? 'left' : 'right'
}
