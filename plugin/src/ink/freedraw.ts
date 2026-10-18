/** Shared freehand geometry for live ink and imported pencil strokes; legacy ink stays readable. */
import { getStroke, getStrokePoints, type StrokeOptions } from 'perfect-freehand'

export interface FreedrawProfile {
  simulatePressure: boolean
  streamline: number
}

interface FreedrawStroke {
  tool?: 'pen' | 'marker'
  size: number
  points: number[]
  freedraw?: FreedrawProfile
}

export const liveFreedraw = (pen: boolean): FreedrawProfile => ({
  simulatePressure: !pen,
  streamline: 0.5,
})

export function readFreedraw(value: unknown): FreedrawProfile | undefined {
  const p = value as Partial<FreedrawProfile> | null
  return p &&
    typeof p.simulatePressure === 'boolean' &&
    typeof p.streamline === 'number' &&
    Number.isFinite(p.streamline) &&
    p.streamline >= 0 &&
    p.streamline <= 1
    ? { simulatePressure: p.simulatePressure, streamline: p.streamline }
    : undefined
}

function input(stroke: FreedrawStroke): number[][] {
  // Excalidraw supplies pairs for simulated pressure, including its initial .25 fallback.
  const dimensions = stroke.freedraw?.simulatePressure ? 2 : 3
  return Array.from({ length: stroke.points.length / 3 }, (_, i) =>
    stroke.points.slice(i * 3, i * 3 + dimensions)
  )
}

/**
 * Excalidraw packages/element/src/shape.ts, variable-width freedraw (perfect-freehand 1.2.0):
 * size=strokeWidth*4.25, thinning=.6, smoothing=.5, streamline=.5 by default, easeOutSine.
 * Our stored size is the half-pressure diameter, sqrt(2) times their size parameter.
 * https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/shape.ts
 * https://github.com/excalidraw/excalidraw/blob/master/packages/common/src/constants.ts
 */
function options(stroke: FreedrawStroke): StrokeOptions & { size: number } {
  return {
    size: stroke.tool === 'marker' ? stroke.size : stroke.size / Math.SQRT2,
    thinning: stroke.tool === 'marker' ? 0 : 0.6,
    smoothing: 0.5,
    streamline: stroke.freedraw?.streamline,
    simulatePressure: stroke.freedraw?.simulatePressure,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    last: true,
  }
}

/** Quadratic outline, including the closing midpoint, as in Excalidraw's SVG/canvas path. */
export function freedrawPath(stroke: FreedrawStroke): string {
  const outline = getStroke(input(stroke), options(stroke))
  if (!outline.length) return ''
  const first = outline[0]
  let d = `M${first[0]} ${first[1]}`
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i],
      b = outline[(i + 1) % outline.length]
    d += `Q${a[0]} ${a[1]} ${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}`
  }
  return `${d}L${first[0]} ${first[1]}Z`
}

const outlines = new WeakMap<FreedrawStroke, number[][]>()
/** Immutable completed strokes share the painted quadratic boundary, within a tenth unit. */
export function freedrawOutline(stroke: FreedrawStroke): number[][] {
  const known = outlines.get(stroke)
  if (known) return known
  const outline = getStroke(input(stroke), options(stroke))
  const out: number[][] = []
  let from = outline[0]
  if (from) out.push(from)
  for (let i = 0; i < outline.length; i++) {
    const b = outline[i],
      c = outline[(i + 1) % outline.length]
    const to = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]
    const steps = Math.max(
      1,
      Math.ceil(Math.sqrt(Math.hypot(from[0] - 2 * b[0] + to[0], from[1] - 2 * b[1] + to[1]) / 0.4))
    )
    for (let k = 1; k <= steps; k++) {
      const t = k / steps,
        u = 1 - t
      out.push([
        u * u * from[0] + 2 * u * t * b[0] + t * t * to[0],
        u * u * from[1] + 2 * u * t * b[1] + t * t * to[1],
      ])
    }
    from = to
  }
  // The source closes its outline with a short straight segment through the first vertex.
  if (outline.length) out.push(outline[0])
  outlines.set(stroke, out)
  return out
}

/** Bounds include short-stroke caps, which can extend beyond a centreline nib radius. */
export function freedrawBounds(stroke: FreedrawStroke): {
  x: number
  y: number
  width: number
  height: number
} {
  const outline = freedrawOutline(stroke)
  if (!outline.length) return { x: 0, y: 0, width: 0, height: 0 }
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const [px, py] of outline) {
    x = Math.min(x, px)
    y = Math.min(y, py)
    right = Math.max(right, px)
    bottom = Math.max(bottom, py)
  }
  // The flattened quadratic boundary differs from the curve by at most .1 units.
  return { x: x - 0.1, y: y - 0.1, width: right - x + 0.2, height: bottom - y + 0.2 }
}

/** Picking follows the streamlined centreline rather than the raw stair-stepped samples. */
export function freedrawCenterline(stroke: FreedrawStroke): number[] {
  const opts = options(stroke),
    pts = getStrokePoints(input(stroke), opts)
  if (!pts.length) return []
  const size = opts.size
  // The same velocity recurrence and initial average as perfect-freehand's outline.
  const simulated = (previous: number, distance: number) => {
    const speed = Math.min(1, distance / size)
    return Math.min(1, previous + (1 - speed - previous) * speed * 0.275)
  }
  let previous = pts
    .slice(0, 10)
    .reduce(
      (acc, p) => (acc + (opts.simulatePressure ? simulated(acc, p.distance) : p.pressure)) / 2,
      pts[0].pressure
    )
  let vector = pts[0].vector,
    sharp = false
  const total = pts[pts.length - 1].runningLength
  const out: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (i < pts.length - 1 && total - p.runningLength < 3) continue
    const pressure = opts.simulatePressure ? simulated(previous, p.distance) : p.pressure
    const diameter =
      stroke.tool === 'marker' ? size : 2 * size * Math.sin(((0.2 + 0.6 * pressure) * Math.PI) / 2)
    // Erasing consumes native half-pressure widths. Bake the source nib response once.
    const nativePressure = Math.max(0, Math.min(1, (diameter / stroke.size - 0.4) / 1.2))
    out.push(p.point[0], p.point[1], nativePressure)
    const next = pts[Math.min(i + 1, pts.length - 1)].vector
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1]
    const nextSharp = dot(p.vector, next) < 0
    if ((!sharp && dot(p.vector, vector) < 0) || nextSharp) {
      if (nextSharp) sharp = true
      continue
    }
    sharp = false
    previous = pressure
    vector = p.vector
  }
  return out
}
