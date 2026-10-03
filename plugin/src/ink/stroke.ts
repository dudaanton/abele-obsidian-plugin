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

/** How close points must come for the hand's shake between them to be eased out. */
const EASE = 2

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
    // Points a quick hand left far apart are where it went: pulling them in would cut corners.
    if (Math.hypot(pt.x - a.x, pt.y - a.y) > EASE || Math.hypot(b.x - pt.x, b.y - pt.y) > EASE)
      return pt
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

/** Where a pen's points came further apart than this, a curve through them fills the gap. */
const STEP = 1
/** How far a point may stray from a straight run, width included, before it is kept. */
const TOLERANCE = 0.1

/**
 * The points a quick hand left far apart joined by a curve through them and their neighbours
 * (Catmull-Rom), the width following along, so a fast circle comes out round rather than a
 * polygon.
 */
function densify(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts
  const out: Pt[] = [pts[0]]
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const n = Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / STEP)
    for (let k = 1; k < n; k++) {
      const t = k / n
      const t2 = t * t
      const t3 = t2 * t
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({
        x: cr(p0.x, p1.x, p2.x, p3.x),
        y: cr(p0.y, p1.y, p2.y, p3.y),
        r: p1.r + (p2.r - p1.r) * t,
      })
    }
    out.push(p2)
  }
  return out
}

/** Runs that go straight at an even width taken as one piece: fewer pieces, the same shape. */
function simplify(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts
  const out: Pt[] = [pts[0]]
  let a = 0
  for (let j = 2; j < pts.length; j++) {
    const A = pts[a]
    const B = pts[j]
    let straight = j - a < 64
    for (let k = a + 1; straight && k < j; k++) {
      const P = pts[k]
      const dx = B.x - A.x
      const dy = B.y - A.y
      const len = dx * dx + dy * dy
      const t = len ? Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len)) : 0
      const off = Math.hypot(A.x + t * dx - P.x, A.y + t * dy - P.y)
      straight = off <= TOLERANCE && Math.abs(A.r + (B.r - A.r) * t - P.r) <= TOLERANCE
    }
    if (!straight) {
      a = j - 1
      out.push(pts[a])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** A circle, wound the way every piece of the pen's outline is (clockwise on the screen). */
const circle = (c: Pt) =>
  `M${f(c.x - c.r)} ${f(c.y)}A${f(c.r)} ${f(c.r)} 0 1 1 ${f(c.x + c.r)} ${f(c.y)}` +
  `A${f(c.r)} ${f(c.r)} 0 1 1 ${f(c.x - c.r)} ${f(c.y)}Z`

interface XY {
  x: number
  y: number
}

/**
 * The band between two circles: the lines touching both, from one to the other — its corners on
 * the left side at `a` and at `b`, then on the right side at `b` and at `a`. Null when one circle
 * holds the other, and the circles alone are the shape.
 */
function band(a: Pt, b: Pt): XY[] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  if (d <= Math.abs(a.r - b.r) + 1e-6) return null
  const ux = dx / d
  const uy = dy / d
  const cos = (a.r - b.r) / d
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos))
  const n1 = { x: ux * cos - uy * sin, y: ux * sin + uy * cos }
  const n2 = { x: ux * cos + uy * sin, y: -ux * sin + uy * cos }
  return [
    { x: a.x + n1.x * a.r, y: a.y + n1.y * a.r },
    { x: b.x + n1.x * b.r, y: b.y + n1.y * b.r },
    { x: b.x + n2.x * b.r, y: b.y + n2.y * b.r },
    { x: a.x + n2.x * a.r, y: a.y + n2.y * a.r },
  ]
}

/** How far a straight edge may fall short of the round nib it stands in for. */
const SAG = 0.03

/** A piece of as many corners as it has, wound as the circles are. */
function piece(pts: XY[]): string {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    area += a.x * b.y - b.x * a.y
  }
  if (Math.abs(area) < 1e-6) return ''
  const [first, ...rest] = area < 0 ? [...pts].reverse() : pts
  return `M${f(first.x)} ${f(first.y)}` + rest.map((p) => `L${f(p.x)} ${f(p.y)}`).join('') + 'Z'
}

/**
 * What fills the opening where one band ends at a nib and the next begins. Their ends are two
 * chords of the nib's circle, and between them a wedge is left open on the outside of a turn. The
 * four ends of the chords, lying on one circle, make a convex piece that covers everything between
 * the chords, meeting each band along its own edge or crossing it — never leaving a crack. A
 * gentle turn needs nothing more (the arc it stands in for bulges less than `SAG`); a sharp one
 * takes the whole nib.
 */
function joint(at: Pt, before: XY[], next: XY[]): string {
  const corners = [before[1], next[0], before[2], next[3]]
  const angle = (p: XY) => Math.atan2(p.y - at.y, p.x - at.x)
  const turn = (p: XY, q: XY) =>
    Math.abs(Math.atan2(Math.sin(angle(q) - angle(p)), Math.cos(angle(q) - angle(p))))
  const widest = Math.max(turn(corners[0], corners[1]), turn(corners[2], corners[3]))
  if (at.r * (1 - Math.cos(widest / 2)) > SAG) return circle(at)
  return piece(corners.sort((p, q) => angle(p) - angle(q)))
}

/**
 * The pen's outline: a round nib at each end, and between each two points the band that joins
 * them — every piece convex and wound the same way, so the filled whole is exactly where the nib
 * went. An outline traced round both sides of the line instead twists wherever the pen doubles
 * back or trembles, and the twisted parts cancel out into gaps.
 *
 * Where two bands meet nearly in line, the second starts from the first one's corners, so no
 * crack is left between them; where the line turns, `joint` fills the opening they leave.
 */
function penPath(raw: Pt[]): string {
  const pts = simplify(densify(raw))
  let d = circle(pts[0])
  let before: XY[] | null = null
  for (let i = 0; i + 1 < pts.length; i++) {
    const q = band(pts[i], pts[i + 1])
    if (i > 0) {
      if (!q || !before) d += circle(pts[i])
      else if (
        Math.max(
          Math.hypot(q[0].x - before[1].x, q[0].y - before[1].y),
          Math.hypot(q[3].x - before[2].x, q[3].y - before[2].y)
        ) <=
        pts[i].r / 10
      ) {
        q[0] = before[1]
        q[3] = before[2]
      } else d += joint(pts[i], before, q)
    }
    if (q) d += piece(q)
    before = q
  }
  return d + circle(pts[pts.length - 1])
}

/**
 * The path drawn for a stroke. The pen: its outline, round nibs joined by bands, at the width the
 * pressure gave each point, to be filled. The marker: the line itself, to be stroked at its width.
 */
export function strokePath(stroke: InkStroke): string {
  const pts = points(stroke)
  if (!pts.length) return ''
  if (stroke.tool === 'marker') {
    if (pts.length === 1) return `M${f(pts[0].x)} ${f(pts[0].y)}l0 0`
    return smooth(pts)
  }
  if (pts.length === 1) return dot(pts[0].x, pts[0].y, pts[0].r)
  return penPath(pts)
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
