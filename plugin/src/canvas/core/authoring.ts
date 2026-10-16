/** Portable precise authoring commands; host rendering supplies fit measurements. */
import { z } from 'zod'
import {
  SHAPES,
  bounds,
  parentsOf,
  recordParents,
  type CanvasGraph,
  type CanvasNode,
} from './model'
import { moveIds } from './selection'

export const styleInputSchema = z
  .object({
    shape: z.enum(SHAPES).optional(),
    border: z.enum(['solid', 'dashed', 'dotted', 'invisible']).optional(),
    path: z.enum(['solid', 'dashed', 'dotted']).optional(),
    arrow: z.enum(['triangle', 'circle', 'diamond', 'bar', 't-shaped', 'square']).optional(),
  })
  .strict()
export function validateStyle(value: unknown) {
  const parsed = styleInputSchema.safeParse(value)
  if (!parsed.success)
    throw new Error(
      'Unsupported style. Supported keys: shape, border (solid/dashed/dotted/invisible), path (solid/dashed/dotted), arrow (triangle/circle/diamond/bar/t-shaped/square). Font, padding, background and radius follow the host theme and shape; use color for card background.'
    )
  return parsed.data
}
const ids = z.array(z.string().min(1)).min(2)
export const pointSchema = z.object({ x: z.number(), y: z.number() }).strict()
export const authoringSchemas = [
  z
    .object({
      op: z.literal('align'),
      ids,
      axis: z.enum(['left', 'right', 'top', 'bottom', 'center_x', 'center_y']),
    })
    .strict(),
  z
    .object({ op: z.literal('same_size'), ids, dimension: z.enum(['width', 'height', 'both']) })
    .strict(),
  z
    .object({
      op: z.literal('distribute'),
      ids: ids.min(3),
      axis: z.enum(['horizontal', 'vertical']),
      gap: z.number().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('fit'),
      ids: z.array(z.string().min(1)).min(1),
      width: z.number().positive().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('route'),
      id: z.string().min(1),
      fromSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
      toSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
      waypoints: z.array(pointSchema).max(100).optional(),
      labelPosition: pointSchema.nullable().optional(),
      method: z.enum(['direct', 'bezier', 'square', 'avoid']).optional(),
    })
    .strict(),
] as const
export type AuthoringOperation = z.output<(typeof authoringSchemas)[number]>
export interface ContentMeasurement {
  width: number
  height: number
  contentWidth?: number
  contentHeight?: number
}
export type MeasureCard = (node: CanvasNode) => ContentMeasurement
export function applyAuthoring(
  graph: CanvasGraph,
  op: AuthoringOperation,
  measure?: MeasureCard
): void {
  if (op.op === 'route') {
    const edge = graph.edges.find((e) => e.id === op.id)
    if (!edge) throw new Error(`Unknown edge ${op.id}`)
    if (op.fromSide) edge.fromSide = op.fromSide
    if (op.toSide) edge.toSide = op.toSide
    if (op.method) edge.pathfindingMethod = op.method === 'avoid' ? 'square' : op.method
    edge.abele = {
      ...edge.abele,
      ...(op.method ? { avoidCards: op.method === 'avoid', waypoints: [] } : {}),
      ...(op.waypoints ? { waypoints: op.waypoints } : {}),
      ...(op.labelPosition !== undefined ? { labelPosition: op.labelPosition } : {}),
    }
    return
  }
  if (new Set(op.ids).size !== op.ids.length) throw new Error('Duplicate selected ids')
  const nodes = op.ids.map((id) => {
    const node = graph.nodes.find((n) => n.id === id)
    if (!node) throw new Error(`Unknown id ${id}; select card ids from canvas_read`)
    return node
  })
  const parents = parentsOf(graph)
  // An ancestor and descendant cannot be independently aligned without ambiguous movement.
  for (const node of nodes) {
    let parent = parents.get(node.id)
    while (parent) {
      if (op.ids.includes(parent)) throw new Error('Select a group or its descendants, not both')
      parent = parents.get(parent)
    }
  }
  const move = (node: CanvasNode, x: number, y: number) => {
    const dx = x - node.x,
      dy = y - node.y
    const moving = moveIds(graph, new Set([node.id]))
    for (const member of graph.nodes)
      if (moving.has(member.id)) {
        member.x += dx
        member.y += dy
      }
  }
  if (op.op === 'align') {
    const box = bounds(nodes)
    for (const n of nodes)
      move(
        n,
        op.axis === 'left'
          ? box.x
          : op.axis === 'right'
            ? box.x + box.width - n.width
            : op.axis === 'center_x'
              ? box.x + (box.width - n.width) / 2
              : n.x,
        op.axis === 'top'
          ? box.y
          : op.axis === 'bottom'
            ? box.y + box.height - n.height
            : op.axis === 'center_y'
              ? box.y + (box.height - n.height) / 2
              : n.y
      )
  } else if (op.op === 'same_size') {
    if (nodes.some((n) => n.type === 'group')) throw new Error('Resize cards only, not groups')
    for (const n of nodes) {
      if (op.dimension !== 'height') n.width = nodes[0].width
      if (op.dimension !== 'width') n.height = nodes[0].height
    }
  } else if (op.op === 'distribute') {
    const horizontal = op.axis === 'horizontal',
      position = horizontal ? 'x' : 'y',
      size = horizontal ? 'width' : 'height'
    nodes.sort((a, b) => a[position] - b[position] || a.id.localeCompare(b.id))
    const first = nodes[0],
      last = nodes[nodes.length - 1]
    const gap =
      op.gap ??
      (last[position] + last[size] - first[position] - nodes.reduce((sum, n) => sum + n[size], 0)) /
        (nodes.length - 1)
    if (gap < 0)
      throw new Error('Selection has insufficient space for nonnegative gaps; supply gap')
    let cursor = first[position]
    for (const n of nodes) {
      move(n, horizontal ? cursor : n.x, horizontal ? n.y : cursor)
      cursor += n[size] + gap
    }
  } else {
    if (!measure) throw new Error('Fit requires host rendered measurements')
    for (const n of nodes) {
      if (n.type !== 'text' && n.type !== 'file')
        throw new Error('Fit requires a text or Markdown card')
      if (op.width) n.width = op.width
      const measured = measure(n)
      if (![measured.width, measured.height].every((v) => Number.isFinite(v) && v > 0))
        throw new Error('Renderer returned invalid dimensions')
      n.width = measured.width
      n.height = measured.height
    }
  }
  recordParents(graph, parents)
}
