/**
 * Picking items out of a drawing: those a lasso goes round, the one a tap lands on, the box round
 * what is picked and the handle at its corner that scales it.
 *
 * A stroke is taken by a lasso when most of its points are inside the loop — a loop drawn in a
 * hurry cuts the ends of what it meant to take — a shape when its middle and most of its corners
 * are, a text block when its middle is.
 */
import { boundsOf, hitItem, union, type DrawingItem, type Rect } from './items'

/** Whether a point is inside a loop given as `x, y` pairs one after the other. */
export function insideLoop(loop: readonly number[], x: number, y: number): boolean {
  let inside = false
  const n = loop.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = loop[2 * i]
    const yi = loop[2 * i + 1]
    const xj = loop[2 * j]
    const yj = loop[2 * j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside
  }
  return inside
}

/** The points of an item a lasso has to hold. */
function samples(item: DrawingItem): [number, number][] {
  if (item.type === 'stroke') {
    const out: [number, number][] = []
    const pts = item.points
    // Enough points for the question, not every one of a long stroke.
    const step = Math.max(1, Math.floor(pts.length / 3 / 40)) * 3
    for (let i = 0; i + 1 < pts.length; i += step) out.push([pts[i], pts[i + 1]])
    return out
  }
  const b = boundsOf(item)
  const mid: [number, number] = [b.x + b.w / 2, b.y + b.h / 2]
  if (item.type === 'text') return [mid]
  if (item.type === 'note')
    return [mid, [b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
  return [mid, [item.x1, item.y1], [item.x2, item.y2], [item.x1, item.y2], [item.x2, item.y1]]
}

/** The items a lasso goes round, by id. */
export function lassoPick(items: readonly DrawingItem[], loop: readonly number[]): string[] {
  if (loop.length < 6) return []
  const xs = loop.filter((_, i) => i % 2 === 0)
  const ys = loop.filter((_, i) => i % 2 === 1)
  const box: Rect = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
  const out: string[] = []
  for (const item of items) {
    const b = boundsOf(item)
    if (b.x > box.x + box.w || b.x + b.w < box.x || b.y > box.y + box.h || b.y + b.h < box.y)
      continue
    const pts = samples(item)
    const inside = pts.filter(([x, y]) => insideLoop(loop, x, y)).length
    if (inside * 2 > pts.length) out.push(item.id)
  }
  return out
}

/** The topmost item under a point, by id; null for none. */
export function itemAt(
  items: readonly DrawingItem[],
  x: number,
  y: number,
  radius: number
): string | null {
  for (let i = items.length - 1; i >= 0; i--)
    if (hitItem(items[i], x, y, radius)) return items[i].id
  return null
}

/** Whether a point is inside a box or a ring drawn with the shape tool. */
function insideShape(item: DrawingItem, x: number, y: number): boolean {
  if (item.type !== 'shape' || (item.kind !== 'rect' && item.kind !== 'ellipse')) return false
  const x0 = Math.min(item.x1, item.x2)
  const y0 = Math.min(item.y1, item.y2)
  const w = Math.abs(item.x2 - item.x1)
  const h = Math.abs(item.y2 - item.y1)
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false
  if (item.kind === 'rect') return true
  const nx = (x - x0 - w / 2) / (w / 2 || 1)
  const ny = (y - y0 - h / 2) / (h / 2 || 1)
  return nx * nx + ny * ny <= 1
}

/**
 * What a tap of the lasso picks: the topmost item under it; else the topmost box or ring it
 * lands inside — they are drawn hollow, but a tap in the middle of one means that one.
 */
export function pickAt(
  items: readonly DrawingItem[],
  x: number,
  y: number,
  radius: number
): string | null {
  const hit = itemAt(items, x, y, radius)
  if (hit) return hit
  for (let i = items.length - 1; i >= 0; i--) if (insideShape(items[i], x, y)) return items[i].id
  return null
}

/** The box round the items picked; null when none is. */
export function pickedBounds(
  items: readonly DrawingItem[],
  picked: ReadonlySet<string>
): Rect | null {
  return union(items.filter((i) => picked.has(i.id)).map(boundsOf))
}

/** How far round the scale handle a touch still takes it, in screen pixels. */
export const HANDLE_RADIUS = 14

/** Where a touch lands on the box of what is picked: its scale handle, inside it, or outside. */
export function boxPart(
  box: Rect,
  x: number,
  y: number,
  zoom: number
): 'handle' | 'inside' | 'outside' {
  const r = HANDLE_RADIUS / zoom
  if (Math.hypot(x - (box.x + box.w), y - (box.y + box.h)) <= r) return 'handle'
  const pad = 6 / zoom
  return x >= box.x - pad &&
    x <= box.x + box.w + pad &&
    y >= box.y - pad &&
    y <= box.y + box.h + pad
    ? 'inside'
    : 'outside'
}
