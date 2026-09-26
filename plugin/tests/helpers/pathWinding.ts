/**
 * Whether a point is inside an absolute SVG path (`M`, `L`, `Q`, `A`, `Z`) as a canvas or an SVG
 * fills it — the nonzero rule. The path is flattened into short straight pieces, and the winding
 * number counted: a place where two parts of an outline wind against each other is a hole on the
 * screen, whatever the path looks like written.
 */

type Pt = [number, number]

/** An SVG arc, endpoint form, as points along it (SVG 1.1, F.6.5). */
function arcPoints(
  from: Pt,
  rx: number,
  ry: number,
  rot: number,
  large: number,
  sweep: number,
  to: Pt
): Pt[] {
  if (!rx || !ry) return [to]
  const phi = (rot * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (from[0] - to[0]) / 2
  const dy = (from[1] - to[1]) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let k = Math.sqrt(Math.max(0, num / den))
  if (large === sweep) k = -k
  const cx1 = (k * rx * y1) / ry
  const cy1 = (-k * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  const out: Pt[] = []
  const n = 32
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    out.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy])
  }
  return out
}

/** The path's closed outlines as polygons. */
export function flatten(d: string): Pt[][] {
  const tokens = d.match(/[MLQAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []
  const polys: Pt[][] = []
  let cur: Pt[] = []
  let at: Pt = [0, 0]
  let i = 0
  const nums = (n: number) => tokens.slice(i, (i += n)).map(Number)
  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === 'M') {
      if (cur.length) polys.push(cur)
      const [x, y] = nums(2)
      at = [x, y]
      cur = [at]
    } else if (cmd === 'L') {
      const [x, y] = nums(2)
      at = [x, y]
      cur.push(at)
    } else if (cmd === 'Q') {
      const [qx, qy, x, y] = nums(4)
      const from = at
      for (let s = 1; s <= 16; s++) {
        const t = s / 16
        const u = 1 - t
        cur.push([
          u * u * from[0] + 2 * u * t * qx + t * t * x,
          u * u * from[1] + 2 * u * t * qy + t * t * y,
        ])
      }
      at = [x, y]
    } else if (cmd === 'A') {
      const [rx, ry, rot, large, sweep, x, y] = nums(7)
      cur.push(...arcPoints(at, rx, ry, rot, large, sweep, [x, y]))
      at = [x, y]
    } else if (cmd === 'Z') {
      if (cur.length) polys.push(cur)
      at = cur[0] ?? at
      cur = []
    } else throw new Error(`unexpected path command ${cmd}`)
  }
  if (cur.length) polys.push(cur)
  return polys
}

const boxes = new WeakMap<Pt[], [number, number, number, number]>()

/** Whether a point is within a polygon's box, which a polygon further off cannot wind round. */
function near(poly: Pt[], x: number, y: number): boolean {
  let box = boxes.get(poly)
  if (!box) {
    const xs = poly.map((p) => p[0])
    const ys = poly.map((p) => p[1])
    box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    boxes.set(poly, box)
  }
  return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]
}

/** The nonzero winding number of a point in a path. */
export function winding(d: string | Pt[][], x: number, y: number): number {
  const polys = typeof d === 'string' ? flatten(d) : d
  let w = 0
  for (const poly of polys) {
    if (!near(poly, x, y)) continue
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i]
      const [bx, by] = poly[(i + 1) % poly.length]
      const cross = (bx - ax) * (y - ay) - (x - ax) * (by - ay)
      if (ay <= y && by > y && cross > 0) w++
      else if (ay > y && by <= y && cross < 0) w--
    }
  }
  return w
}

/** Whether a canvas filling the path paints the point. */
export const filled = (d: string | Pt[][], x: number, y: number) => winding(d, x, y) !== 0
