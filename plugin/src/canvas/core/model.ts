/** JSON Canvas + extension data, independent of any vault or host API. */
import { z } from 'zod'

export const SHAPES = [
  'rectangle',
  'pill',
  'diamond',
  'parallelogram',
  'circle',
  'predefined-process',
  'document',
  'database',
] as const
export type Shape = (typeof SHAPES)[number]
export type Side = 'top' | 'right' | 'bottom' | 'left'
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface CanvasNode extends Rect {
  [key: string]: unknown
  id: string
  type: 'text' | 'file' | 'link' | 'group'
  text?: string
  file?: string
  subpath?: string
  url?: string
  label?: string
  collapsed?: boolean
  color?: string
  styleAttributes?: Record<string, unknown>
  abele?: Record<string, unknown>
}
export interface CanvasEdge {
  [key: string]: unknown
  id: string
  fromNode: string
  toNode: string
  fromSide?: Side
  toSide?: Side
  fromEnd?: 'none' | 'arrow'
  toEnd?: 'none' | 'arrow'
  color?: string
  label?: string
  pathfindingMethod?: string
  styleAttributes?: Record<string, unknown>
  abele?: Record<string, unknown>
}
export interface CanvasGraph {
  [key: string]: unknown
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  abele?: Record<string, unknown>
}
const id = z.string().min(1)
const extension = z.record(z.string(), z.unknown())
export const nodeSchema = z
  .object({
    id,
    type: z.enum(['text', 'file', 'link', 'group']),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    text: z.string().optional(),
    file: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    subpath: z.string().optional(),
    label: z.string().optional(),
    collapsed: z.boolean().optional(),
    color: z.string().optional(),
    styleAttributes: extension.optional(),
    abele: extension.optional(),
  })
  .loose()
  .superRefine((node, ctx) => {
    const field =
      node.type === 'text'
        ? 'text'
        : node.type === 'file'
          ? 'file'
          : node.type === 'link'
            ? 'url'
            : null
    if (field && node[field] === undefined)
      ctx.addIssue({ code: 'custom', message: `${node.id}: ${node.type} requires ${field}` })
  })
export const edgeSchema = z
  .object({
    id,
    fromNode: id,
    toNode: id,
    fromSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
    toSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
    fromEnd: z.enum(['none', 'arrow']).optional(),
    toEnd: z.enum(['none', 'arrow']).optional(),
    color: z.string().optional(),
    label: z.string().optional(),
    pathfindingMethod: z.string().optional(),
    styleAttributes: extension.optional(),
    abele: extension.optional(),
  })
  .loose()
const schema = z
  .object({ nodes: z.array(nodeSchema), edges: z.array(edgeSchema), abele: extension.optional() })
  .loose()
export function parseCanvas(input: unknown): CanvasGraph {
  const graph = schema.parse(typeof input === 'string' ? JSON.parse(input) : input)
  const ids = new Set<string>()
  for (const element of [...graph.nodes, ...graph.edges]) {
    if (ids.has(element.id)) throw new Error(`Duplicate canvas id: ${element.id}`)
    ids.add(element.id)
  }
  parentsOf(graph) // Refuse ambiguous/cyclic explicit hierarchy before edits can destroy it.
  return graph
}
export const emptyCanvas = (): CanvasGraph => ({ nodes: [], edges: [] })
export const serializeCanvas = (graph: CanvasGraph): string =>
  JSON.stringify(parseCanvas(graph), null, 2) + '\n'
export const cloneCanvas = (graph: CanvasGraph): CanvasGraph =>
  parseCanvas(JSON.parse(JSON.stringify(graph)))
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
export function bounds(rects: readonly Rect[], margin = 0): Rect {
  if (!rects.length)
    return { x: -margin, y: -margin, width: 1 + 2 * margin, height: 1 + 2 * margin }
  const x = Math.min(...rects.map((r) => r.x)),
    y = Math.min(...rects.map((r) => r.y))
  return {
    x: x - margin,
    y: y - margin,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x + 2 * margin,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y + 2 * margin,
  }
}
/** Explicit Abele parents win. Native canvases express group membership by containment. */
export function parentsOf(graph: CanvasGraph): Map<string, string> {
  const result = new Map<string, string>(),
    groups = graph.nodes.filter((n) => n.type === 'group')
  for (const node of graph.nodes) {
    const parent = node.abele?.parent
    if (parent !== undefined && parent !== null) {
      if (typeof parent !== 'string' || !groups.some((g) => g.id === parent))
        throw new Error(`${node.id}: unknown parent group ${String(parent)}`)
      result.set(node.id, parent)
    } else if (parent !== null) {
      const candidates = groups
        .filter(
          (g) =>
            g.id !== node.id && contains(g, node) && g.width * g.height > node.width * node.height
        )
        .sort((a, b) => a.width * a.height - b.width * b.height || a.id.localeCompare(b.id))
      if (candidates[0]) result.set(node.id, candidates[0].id)
    }
  }
  for (const id of result.keys()) {
    const seen = new Set([id])
    let parent = result.get(id)
    while (parent) {
      if (seen.has(parent)) throw new Error(`Canvas containment cycle at ${id}`)
      seen.add(parent)
      parent = result.get(parent)
    }
  }
  return result
}
export function descendants(id: string, parents: Map<string, string>): string[] {
  const out: string[] = []
  for (const key of parents.keys()) {
    let parent = parents.get(key)
    while (parent) {
      if (parent === id) {
        out.push(key)
        break
      }
      parent = parents.get(parent)
    }
  }
  return out
}
/** Native stacking/key order is not a content change; step/ink arrays still are. */
export function canvasFingerprint(graph: CanvasGraph): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, canonical(child)])
      )
    return value
  }
  return JSON.stringify(
    canonical({
      ...graph,
      nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      edges: graph.edges
        .map((edge) => ({
          ...edge,
          label: edge.label ?? '',
          fromEnd: edge.fromEnd ?? 'none',
          toEnd: edge.toEnd ?? 'arrow',
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    })
  )
}
export const labelOf = (node: CanvasNode): string =>
  node.text ?? node.label ?? node.file ?? node.url ?? node.id
