/**
 * A stroke drawn on a page: the points it went through, with the pen's pressure at each, and the
 * shape that is drawn for it.
 *
 * Points are in the page's own units — a PDF page at 100% — so a stroke keeps its place and size
 * at every zoom. The pen is drawn as a filled outline whose width follows the pressure, the way
 * ink from a nib looks; the marker is a wide, even, see-through line. Written here rather than
 * taken from a library: the shapes are simple, and nothing has to be added to the plugin for them.
 */

export type InkTool = 'pen' | 'marker'

/** The colours the bar offers each tool: ink colours for the pen, highlighter colours for the marker. */
export const INK_COLORS = {
  pen: ['black', 'red', 'blue', 'green'],
  marker: ['yellow', 'green', 'blue', 'pink'],
} as const

export type InkColor = (typeof INK_COLORS)[InkTool][number]

/**
 * Each colour on paper. Literal, not the theme's: the page is white paper in every theme, and the
 * file must look the same wherever it is opened.
 */
const LITERAL: Record<InkColor, string> = {
  black: '#1f1f1f',
  red: '#e03131',
  blue: '#1864d6',
  green: '#2b8a3e',
  yellow: '#f5c400',
  pink: '#e64980',
}

export const isInkColor = (value: unknown): value is InkColor =>
  typeof value === 'string' && value in LITERAL

export function inkLiteral(color: InkColor): string {
  return LITERAL[color] ?? LITERAL.black
}

/** How see-through the marker is. */
export const MARKER_OPACITY = 0.4

export interface InkStroke {
  tool: InkTool
  color: InkColor
  /** The width at half pressure (the pen) or throughout (the marker), in page units. */
  size: number
  /** `x, y, pressure` for each point, one after the other. */
  points: number[]
}

/** The pen's width at a pressure: as set at half pressure, thinner lighter, wider harder. */
export function penWidth(size: number, pressure: number): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(pressure) ? pressure : 0.5))
  return size * (0.4 + 1.2 * p)
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

/** A point as it is kept: a tenth of a unit, a hundredth of the pressure, pressure within 0–1. */
export function roundPoint(x: number, y: number, p: number): [number, number, number] {
  return [r1(x), r1(y), r2(Math.min(1, Math.max(0, p)))]
}

interface Pt {
  x: number
  y: number
  r: number
}

/** The stroke's points, a point too close to the one before dropped, and eased a little. */
function points(stroke: InkStroke): Pt[] {
  const raw: Pt[] = []
  const pts = stroke.points
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const pt = { x: pts[i], y: pts[i + 1], r: penWidth(stroke.size, pts[i + 2]) / 2 }
    const last = raw[raw.length - 1]
    if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.3) {
      last.r = Math.max(last.r, pt.r)
      continue
    }
    raw.push(pt)
  }
  if (raw.length < 3) return raw
  // Each inner point pulled toward its neighbours, the width too: a shaky hand, a jumpy
  // pressure reading, come out as a smooth line.
  return raw.map((pt, i) => {
    if (i === 0 || i === raw.length - 1) return pt
    const a = raw[i - 1]
    const b = raw[i + 1]
    return {
      x: (a.x + 2 * pt.x + b.x) / 4,
      y: (a.y + 2 * pt.y + b.y) / 4,
      r: (a.r + 2 * pt.r + b.r) / 4,
    }
  })
}

const f = (n: number) => String(r2(n))

/** A smooth line through points: straight to the first midpoint, curves between the others. */
function smooth(pts: { x: number; y: number }[], move = true): string {
  if (!pts.length) return ''
  let d = move ? `M${f(pts[0].x)} ${f(pts[0].y)}` : `L${f(pts[0].x)} ${f(pts[0].y)}`
  if (pts.length === 1) return d
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2
    const my = (pts[i].y + pts[i + 1].y) / 2
    d += `Q${f(pts[i].x)} ${f(pts[i].y)} ${f(mx)} ${f(my)}`
  }
  const last = pts[pts.length - 1]
  return `${d}L${f(last.x)} ${f(last.y)}`
}

/** A dot: a circle of radius `r` at a point. */
const dot = (x: number, y: number, r: number) =>
  `M${f(x - r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x + r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x - r)} ${f(y)}Z`

/**
 * The path drawn for a stroke. The pen: its outline, both sides of the line at the width the
 * pressure gave each point, round at the ends, to be filled. The marker: the line itself, to be
 * stroked at its width.
 */
export function strokePath(stroke: InkStroke): string {
  const pts = points(stroke)
  if (!pts.length) return ''
  if (stroke.tool === 'marker') {
    if (pts.length === 1) return `M${f(pts[0].x)} ${f(pts[0].y)}l0 0`
    return smooth(pts)
  }
  if (pts.length === 1) return dot(pts[0].x, pts[0].y, pts[0].r)
  const left: { x: number; y: number }[] = []
  const right: { x: number; y: number }[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    const { x, y, r } = pts[i]
    left.push({ x: x + nx * r, y: y + ny * r })
    right.push({ x: x - nx * r, y: y - ny * r })
  }
  const end = pts[pts.length - 1]
  const start = pts[0]
  const back = right.reverse()
  return (
    smooth(left) +
    `A${f(end.r)} ${f(end.r)} 0 0 1 ${f(back[0].x)} ${f(back[0].y)}` +
    smooth(back, false) +
    `A${f(start.r)} ${f(start.r)} 0 0 1 ${f(left[0].x)} ${f(left[0].y)}Z`
  )
}

/** How far a point is from the segment between two others, squared. */
function distSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  const x = ax + t * dx - px
  const y = ay + t * dy - py
  return x * x + y * y
}

/** Whether an eraser of `radius` at a point touches the stroke. */
export function hitStroke(stroke: InkStroke, x: number, y: number, radius: number): boolean {
  const pts = stroke.points
  const half = stroke.tool === 'marker' ? stroke.size / 2 : penWidth(stroke.size, 1) / 2
  const reach = (radius + half) ** 2
  if (pts.length < 3) return false
  if (pts.length < 6) return distSq(x, y, pts[0], pts[1], pts[0], pts[1]) <= reach
  for (let i = 0; i + 5 < pts.length; i += 3)
    if (distSq(x, y, pts[i], pts[i + 1], pts[i + 3], pts[i + 4]) <= reach) return true
  return false
}
