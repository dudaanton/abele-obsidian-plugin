/** Versioned ink in native Canvas extensions; geometry has no host or persistence dependency. */
import { z } from 'zod'
import { penWidth, strokePath } from '../../ink/stroke'
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
  return node && stroke.frame
    ? {
        x: node.x,
        y: node.y,
        sx: node.width / stroke.frame.width,
        sy: node.height / stroke.frame.height,
      }
    : { x: 0, y: 0, sx: 1, sy: 1 }
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
