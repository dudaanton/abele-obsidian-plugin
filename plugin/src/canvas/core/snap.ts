/**
 * Thin lines of alignment while cards are carried, as Figma, tldraw and Obsidian Canvas draw
 * them: the carried cards' left, middle and right line up with a neighbour's, and their top,
 * middle and bottom, within a few screen pixels, and stick there.
 */
import { bounds, type CanvasGraph, type Rect } from './model'
import { canvasVisibility } from './visibility'

/** A line drawn across the canvas where carried cards line up with another card. */
export interface Guide {
  axis: 'x' | 'y'
  /** Where the line stands, across the other axis. */
  at: number
  /** How far it runs along its axis, over both cards. */
  from: number
  to: number
}

const lines = (r: Rect, axis: 'x' | 'y') =>
  axis === 'x' ? [r.x, r.x + r.width / 2, r.x + r.width] : [r.y, r.y + r.height / 2, r.y + r.height]

/**
 * The move, nudged to the nearest alignment within reach, and the lines that show it. `reach`
 * is in the canvas's units: a few screen pixels at the camera's zoom.
 */
export function snapMove(
  graph: CanvasGraph,
  ids: ReadonlySet<string>,
  moving: ReadonlySet<string>,
  dx: number,
  dy: number,
  reach: number
): { dx: number; dy: number; guides: Guide[] } {
  const carried = graph.nodes.filter((n) => ids.has(n.id))
  if (!carried.length) return { dx, dy, guides: [] }
  const start = bounds(carried)
  const others = canvasVisibility(graph).visible.filter((n) => !moving.has(n.id))
  const best = { x: { d: Infinity, shift: 0 }, y: { d: Infinity, shift: 0 } }
  for (const axis of ['x', 'y'] as const) {
    const moved = { ...start, x: start.x + dx, y: start.y + dy }
    const mine = lines(moved, axis)
    for (const other of others)
      for (const theirs of lines(other, axis))
        for (const line of mine) {
          const d = Math.abs(theirs - line)
          if (d <= reach && d < best[axis].d) best[axis] = { d, shift: theirs - line }
        }
  }
  const sx = best.x.d <= reach ? best.x.shift : 0,
    sy = best.y.d <= reach ? best.y.shift : 0
  const box = { ...start, x: start.x + dx + sx, y: start.y + dy + sy }
  const guides: Guide[] = []
  for (const axis of ['x', 'y'] as const) {
    if ((axis === 'x' ? best.x.d : best.y.d) > reach) continue
    const mine = lines(box, axis)
    for (const other of others) {
      const theirs = lines(other, axis)
      for (const at of mine)
        if (theirs.some((t) => Math.abs(t - at) < 0.5)) {
          const span =
            axis === 'x'
              ? [Math.min(box.y, other.y), Math.max(box.y + box.height, other.y + other.height)]
              : [Math.min(box.x, other.x), Math.max(box.x + box.width, other.x + other.width)]
          guides.push({ axis, at, from: span[0], to: span[1] })
        }
    }
  }
  return { dx: dx + sx, dy: dy + sy, guides }
}
