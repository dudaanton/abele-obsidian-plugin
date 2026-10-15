/**
 * A stroke held still at its end becomes the plain shape it was drawn as, the way Freeform and
 * GoodNotes do it: a line, a rectangle or an ellipse. Anything else stays as it was drawn.
 * Points are `x, y, pressure` triples in the canvas's own units.
 */
import type { Rect } from './model'

export type Recognized =
  | { kind: 'line'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: 'rectangle' | 'circle'; rect: Rect }

/** How far a drawn line may wander from straight, as a share of its length. */
const LINE_SPREAD = 0.06
/** How close a closed shape's ends must come, as a share of its size. */
const CLOSED = 0.28
/** How far a closed shape's points may stray from the ideal, as a share of its size. */
const FIT = 0.11

export function recognizeStroke(points: number[]): Recognized | null {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i + 1 < points.length; i += 3) pts.push({ x: points[i], y: points[i + 1] })
  if (pts.length < 3) return null
  const first = pts[0],
    last = pts[pts.length - 1]
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const width = maxX - minX,
    height = maxY - minY,
    size = Math.max(width, height)
  if (size < 24) return null
  // A line: every point near the segment between the ends.
  const length = Math.hypot(last.x - first.x, last.y - first.y)
  if (length > size * 0.8) {
    const off = Math.max(...pts.map((p) => distanceToSegment(p, first, last)))
    if (off <= Math.max(3, length * LINE_SPREAD)) return { kind: 'line', from: first, to: last }
    return null
  }
  // Closed: the ends meet again near where they started.
  if (length > size * CLOSED || Math.min(width, height) < 16) return null
  const rect = { x: minX, y: minY, width, height }
  const cx = minX + width / 2,
    cy = minY + height / 2
  // How far each point is from an ellipse in the box, and from the box's own edges.
  let ellipse = 0,
    box = 0
  for (const p of pts) {
    const nx = (p.x - cx) / (width / 2),
      ny = (p.y - cy) / (height / 2)
    ellipse += Math.abs(Math.hypot(nx, ny) - 1)
    box += Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y) / (size / 2)
  }
  ellipse /= pts.length
  box /= pts.length
  if (box <= FIT && box < ellipse) return { kind: 'rectangle', rect }
  if (ellipse <= FIT * 1.6) return { kind: 'circle', rect }
  return null
}

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y)
}
