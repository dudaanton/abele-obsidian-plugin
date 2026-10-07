/** Versioned ink in native Canvas extensions; geometry has no host or persistence dependency. */
import { z } from 'zod'
import { penWidth, strokePath, strokeCenterline } from '../../ink/stroke'
import { insideLoop } from '../../drawing/selection'
import { canvasVisibility } from './visibility'
import { bounds, type CanvasGraph, type CanvasNode, type Rect } from './model'

export const inkSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    tool: z.enum(['pen', 'marker']),
    color: z.string().regex(/^(?:[1-6]|#[0-9a-fA-F]{6})?$/),
    size: z.number().positive(),
    points: z
      .array(z.number())
      .min(3)
      .refine(
        (p) => p.length % 3 === 0 && p.every((v, i) => i % 3 !== 2 || (v >= 0 && v <= 1)),
        'Expected x, y, pressure triples'
      ),
    transform: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        sx: z.number().positive(),
        sy: z.number().positive(),
      })
      .strict()
      .optional(),
    frame: z
      .object({ width: z.number().positive(), height: z.number().positive() })
      .strict()
      .optional(),
  })
  .loose()
export type CanvasInk = z.infer<typeof inkSchema>
type Owner = Pick<CanvasGraph, 'abele'>
export interface InkEntry {
  stroke: CanvasInk
  node?: CanvasNode
}
export function rawInk(owner: Owner, writable = false): unknown[] {
  const value = owner.abele?.ink
  if (value === undefined) return []
  if (Array.isArray(value)) return value
  if (writable) throw new Error('Canvas ink has an incompatible extension container')
  return []
}
const entriesCache = new WeakMap<unknown[], CanvasInk[]>()
export function inkOf(owner: Owner): CanvasInk[] {
  const raw = rawInk(owner)
  let entries = entriesCache.get(raw)
  if (!entries) {
    entries = raw.filter((v) => inkSchema.safeParse(v).success) as CanvasInk[]
    entriesCache.set(raw, entries)
  }
  return entries
}
/** Even opaque entries reserve their IDs; never overwrite an unknown ink version. */
export function inkIds(graph: CanvasGraph): string[] {
  return [graph, ...graph.nodes].flatMap((owner) =>
    rawInk(owner).flatMap((v) =>
      v && typeof v === 'object' && 'id' in v && typeof v.id === 'string' ? [v.id] : []
    )
  )
}
export function addInk(graph: CanvasGraph, input: CanvasInk, nodeId?: string): void {
  const stroke = inkSchema.parse(input),
    node = nodeId === undefined ? undefined : graph.nodes.find((n) => n.id === nodeId)
  if (nodeId !== undefined && !node) throw new Error(`Unknown ink attachment ${nodeId}`)
  if (node && !stroke.frame) throw new Error('Attached ink requires its authoring frame')
  if (!node && stroke.frame) throw new Error('Free ink must not have an attachment frame')
  const owner = node ?? graph
  owner.abele = { ...owner.abele, ink: [...rawInk(owner, true), stroke] }
}
export function attachmentAt(graph: CanvasGraph, x: number, y: number): CanvasNode | undefined {
  return canvasVisibility(graph)
    .visible.reverse()
    .find((n) => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height)
}
/** Do not cull an annotation by its owner's rectangle: ink may reach outside it. */
export function inkEntries(graph: CanvasGraph): InkEntry[] {
  const { hidden } = canvasVisibility(graph)
  return [
    ...inkOf(graph)
      .filter((s) => !s.frame)
      .map((stroke) => ({ stroke })),
    ...graph.nodes
      .filter((n) => !hidden.has(n.id))
      .flatMap((node) =>
        inkOf(node)
          .filter((s) => !!s.frame)
          .map((stroke) => ({ stroke, node }))
      ),
  ]
}
export function inkTransform({ stroke, node }: InkEntry) {
  const t = stroke.transform ?? { x: 0, y: 0, sx: 1, sy: 1 }
  if (!node || !stroke.frame) return t
  const sx = node.width / stroke.frame.width,
    sy = node.height / stroke.frame.height
  return { x: node.x + t.x * sx, y: node.y + t.y * sy, sx: t.sx * sx, sy: t.sy * sy }
}
/** Includes hidden owners for semantic edits; picking uses inkEntries instead. */
export function allInkEntries(graph: CanvasGraph): InkEntry[] {
  return [
    ...inkOf(graph)
      .filter((s) => !s.frame)
      .map((stroke) => ({ stroke })),
    ...graph.nodes.flatMap((node) =>
      inkOf(node)
        .filter((s) => !!s.frame)
        .map((stroke) => ({ stroke, node }))
    ),
  ]
}
export function replaceInk(graph: CanvasGraph, entry: InkEntry, strokes: CanvasInk[]): void {
  const owner = entry.node ?? graph
  owner.abele = {
    ...owner.abele,
    ink: rawInk(owner, true).flatMap((value) =>
      (value as CanvasInk)?.id === entry.stroke.id ? strokes : [value]
    ),
  }
}
/** Compose an exact outline transform instead of baking nonuniform nib widths into points. */
export function inkInWorld(entry: InkEntry, transform = inkTransform(entry)): CanvasInk {
  const { frame: _frame, ...stroke } = entry.stroke
  return { ...stroke, transform }
}
export function attachInk(graph: CanvasGraph, entry: InkEntry, nodeId?: string): void {
  const node = nodeId === undefined ? undefined : graph.nodes.find((n) => n.id === nodeId)
  if (nodeId !== undefined && !node) throw new Error(`Unknown ink attachment ${nodeId}`)
  const world = inkInWorld(entry),
    t = world.transform!
  // Check the destination before removing anything, including incompatible opaque containers.
  rawInk(node ?? graph, true)
  replaceInk(graph, entry, [])
  addInk(
    graph,
    node
      ? {
          ...world,
          frame: { width: node.width, height: node.height },
          transform: { ...t, x: t.x - node.x, y: t.y - node.y },
        }
      : world,
    nodeId
  )
}
export function transformInk(
  entry: InkEntry,
  x: number,
  y: number,
  factor: number,
  dx = 0,
  dy = 0
): CanvasInk {
  const t = inkTransform(entry),
    world = {
      x: x + (t.x - x) * factor + dx,
      y: y + (t.y - y) * factor + dy,
      sx: t.sx * factor,
      sy: t.sy * factor,
    }
  const node = entry.node,
    frame = entry.stroke.frame
  if (!node || !frame) return inkInWorld(entry, world)
  const sx = node.width / frame.width,
    sy = node.height / frame.height
  return {
    ...entry.stroke,
    transform: {
      x: (world.x - node.x) / sx,
      y: (world.y - node.y) / sy,
      sx: world.sx / sx,
      sy: world.sy / sy,
    },
  }
}
const boundsCache = new WeakMap<CanvasInk, Rect>()
export function inkBounds(entry: InkEntry): Rect {
  const s = entry.stroke
  let local = boundsCache.get(s)
  if (!local) {
    // Catmull-Rom segments lie inside their Bezier control hull, including overshoot.
    const p = s.points,
      rects: Rect[] = []
    for (let i = 0; i < p.length; i += 3) {
      rects.push({ x: p[i], y: p[i + 1], width: 0, height: 0 })
      if (i + 3 < p.length) {
        const prev = Math.max(0, i - 3),
          next = Math.min(p.length - 3, i + 6)
        rects.push({
          x: p[i] + (p[i + 3] - p[prev]) / 6,
          y: p[i + 1] + (p[i + 4] - p[prev + 1]) / 6,
          width: 0,
          height: 0,
        })
        rects.push({
          x: p[i + 3] - (p[next] - p[i]) / 6,
          y: p[i + 4] - (p[next + 1] - p[i + 1]) / 6,
          width: 0,
          height: 0,
        })
      }
    }
    local = bounds(rects, s.tool === 'marker' ? s.size / 2 : penWidth(s.size, 1) / 2)
    boundsCache.set(s, local)
  }
  const t = inkTransform(entry)
  return {
    x: t.x + local.x * t.sx,
    y: t.y + local.y * t.sy,
    width: local.width * t.sx,
    height: local.height * t.sy,
  }
}
/** The outline is shared with drawing/PDF ink; Canvas colours are resolved by its host theme. */
export const inkPath = (stroke: CanvasInk): string => strokePath({ ...stroke, color: 'black' })

/** Segment/circular eraser intersection in the transformed nib's local coordinates. */
function cutInterval(
  entry: InkEntry,
  x: number,
  y: number,
  radius: number,
  a: number[],
  b: number[]
): [number, number] | null {
  const t = inkTransform(entry),
    s = entry.stroke,
    half = s.tool === 'marker' ? s.size / 2 : penWidth(s.size, Math.max(a[2], b[2])) / 2,
    rx = radius / t.sx + half,
    ry = radius / t.sy + half,
    ax = (a[0] - (x - t.x) / t.sx) / rx,
    ay = (a[1] - (y - t.y) / t.sy) / ry,
    dx = (b[0] - a[0]) / rx,
    dy = (b[1] - a[1]) / ry,
    A = dx * dx + dy * dy,
    B = 2 * (ax * dx + ay * dy),
    C = ax * ax + ay * ay - 1
  if (!A) return C <= 0 ? [0, 1] : null
  const d = B * B - 4 * A * C
  if (d < 0) return null
  const lo = Math.max(0, (-B - Math.sqrt(d)) / (2 * A)),
    hi = Math.min(1, (-B + Math.sqrt(d)) / (2 * A))
  return lo <= hi ? [lo, hi] : null
}
const centrelineCache = new WeakMap<CanvasInk, number[]>()
function centreline(stroke: CanvasInk): number[] {
  let p = centrelineCache.get(stroke)
  if (!p) {
    p = strokeCenterline({ ...stroke, color: 'black' })
    centrelineCache.set(stroke, p)
  }
  return p
}
export function hitInk(entry: InkEntry, x: number, y: number, radius: number): boolean {
  const p = centreline(entry.stroke)
  for (let i = 0; i < p.length; i += 3) {
    const a = p.slice(i, i + 3),
      b = p.slice(Math.min(i + 3, p.length - 3), Math.min(i + 3, p.length - 3) + 3)
    if (cutInterval(entry, x, y, radius, a, b)) return true
  }
  return false
}
/** Splits sparse segments at the eraser boundary, interpolating pressure, never reconnecting gaps. */
export function eraseInk(
  entry: InkEntry,
  x: number,
  y: number,
  radius: number,
  id: () => string
): CanvasInk[] {
  const p = centreline(entry.stroke)
  if (!hitInk(entry, x, y, radius)) return [entry.stroke]
  if (p.length === 3) return []
  const runs: number[][] = []
  let run: number[] = []
  const finish = () => {
    if (run.length) runs.push(run)
    run = []
  }
  const push = (point: number[]) => {
    if (!run.length || point.some((v, i) => v !== run[run.length - 3 + i])) run.push(...point)
  }
  for (let i = 0; i + 3 < p.length; i += 3) {
    const a = p.slice(i, i + 3),
      b = p.slice(i + 3, i + 6),
      cut = cutInterval(entry, x, y, radius, a, b),
      at = (k: number) => a.map((v, j) => v + (b[j] - v) * k)
    if (!cut) {
      push(a)
      push(b)
      continue
    }
    if (cut[0] > 0) {
      push(a)
      push(at(cut[0]))
    }
    finish()
    if (cut[1] < 1) {
      push(at(cut[1]))
      push(b)
    }
  }
  finish()
  return runs.map((points, i) => ({ ...entry.stroke, id: i ? id() : entry.stroke.id, points }))
}
/** Majority sampling reuses the drawing lasso's polygon policy, in world space. */
export function lassoInk(graph: CanvasGraph, loop: readonly number[]): string[] {
  if (loop.length < 6) return []
  const ids = canvasVisibility(graph)
    .visible.filter((n) => {
      const samples = [
        [n.x, n.y],
        [n.x + n.width, n.y],
        [n.x, n.y + n.height],
        [n.x + n.width, n.y + n.height],
        [n.x + n.width / 2, n.y + n.height / 2],
      ]
      return samples.filter(([x, y]) => insideLoop(loop, x, y)).length > samples.length / 2
    })
    .map((n) => n.id)
  for (const entry of inkEntries(graph)) {
    const t = inkTransform(entry),
      p = entry.stroke.points
    let total = 0,
      inside = 0
    for (let i = 0; i < p.length; i += Math.max(1, Math.floor(p.length / 120)) * 3) {
      total++
      if (insideLoop(loop, t.x + p[i] * t.sx, t.y + p[i + 1] * t.sy)) inside++
    }
    if (inside > total / 2) ids.push(entry.stroke.id)
  }
  return ids
}
