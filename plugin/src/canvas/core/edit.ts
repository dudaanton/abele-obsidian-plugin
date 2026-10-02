/** Batched semantic changes are validated on a clone; never partial writes. */
import { z } from 'zod'
import {
  bounds,
  cloneCanvas,
  edgeSchema,
  nodeSchema,
  parentsOf,
  SHAPES,
  type CanvasGraph,
  type CanvasNode,
} from './model'

const id = z.string().min(1),
  object = z.record(z.string(), z.unknown())
export const inputNodeSchema = z
  .object({
    id,
    kind: z.enum(['text', 'note', 'link', 'group', 'shape']),
    label: z.string().default(''),
    file: z.string().optional(),
    url: z.string().optional(),
    subpath: z.string().optional(),
    shape: z.enum(SHAPES).optional(),
    parent: id.optional(),
    near: id.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    styleAttributes: object.optional(),
    abele: object.optional(),
    color: z.string().optional(),
  })
  .strict()
export const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_node'), node: inputNodeSchema }).strict(),
  z.object({ op: z.literal('update'), id, patch: object }).strict(),
  z.object({ op: z.literal('remove'), id }).strict(),
  z.object({ op: z.literal('connect'), edge: edgeSchema }).strict(),
  z
    .object({ op: z.literal('group'), id, label: z.string().optional(), ids: z.array(id).min(1) })
    .strict(),
  z.object({ op: z.literal('ungroup'), id }).strict(),
  z.object({ op: z.literal('collapse'), id, collapsed: z.boolean() }).strict(),
  z.object({ op: z.literal('style'), id, styleAttributes: object }).strict(),
])
export type CanvasOperation = z.input<typeof operationSchema>
export type NodeInput = z.input<typeof inputNodeSchema>
export class CanvasEditError extends Error {
  constructor(
    readonly index: number,
    cause: unknown
  ) {
    super(`Canvas op ${index}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1]
    for (let j = 0; j < b.length; j++)
      next[j + 1] = Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j]))
    row = next
  }
  return row[b.length]
}
function known<T extends { id: string }>(id: string, list: T[]): T {
  const found = list.find((n) => n.id === id)
  if (found) return found
  const suggested = list
    .map((n) => ({ id: n.id, score: distance(id, n.id) }))
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))[0]
  throw new Error(
    `Unknown id ${id}${suggested && suggested.score <= Math.max(2, id.length / 3) ? `; did you mean ${suggested.id}?` : ''}`
  )
}
function unique(graph: CanvasGraph, id: string): void {
  if ([...graph.nodes, ...graph.edges].some((n) => n.id === id))
    throw new Error(`Duplicate id ${id}`)
}
function checkEdges(graph: CanvasGraph): void {
  for (const edge of graph.edges) {
    known(edge.fromNode, graph.nodes)
    known(edge.toNode, graph.nodes)
  }
  parentsOf(graph)
}
export function editCanvas(
  input: CanvasGraph,
  ops: unknown
): { graph: CanvasGraph; needsLayout: boolean } {
  if (!Array.isArray(ops) || !ops.length) throw new Error('ops must be a nonempty array')
  let graph = cloneCanvas(input),
    needsLayout = false
  for (let index = 0; index < ops.length; index++) {
    try {
      const op = operationSchema.parse(ops[index])
      if (op.op === 'add_node') {
        const n = op.node
        unique(graph, n.id)
        if ((n.x === undefined) !== (n.y === undefined))
          throw new Error('Provide both x and y, or neither')
        if (n.parent) {
          const parent = known(n.parent, graph.nodes)
          if (parent.type !== 'group') throw new Error('Parent must be a group')
        }
        const near = n.near ? known(n.near, graph.nodes) : undefined
        const type = n.kind === 'shape' ? 'text' : n.kind === 'note' ? 'file' : n.kind
        const node: CanvasNode = {
          id: n.id,
          type,
          x: n.x ?? (near ? near.x + near.width + 80 : 0),
          y: n.y ?? near?.y ?? 0,
          width: n.width ?? 260,
          height: n.height ?? 160,
          abele: { ...n.abele, parent: n.parent ?? null },
          styleAttributes: { ...n.styleAttributes, ...(n.shape ? { shape: n.shape } : {}) },
          ...(n.color ? { color: n.color } : {}),
          ...(type === 'text'
            ? { text: n.label }
            : type === 'file'
              ? { file: n.file, ...(n.subpath ? { subpath: n.subpath } : {}) }
              : type === 'link'
                ? { url: n.url }
                : { label: n.label }),
        }
        graph.nodes.push(nodeSchema.parse(node))
        if (n.x === undefined && !near) needsLayout = true
      } else if (op.op === 'connect') {
        unique(graph, op.edge.id)
        known(op.edge.fromNode, graph.nodes)
        known(op.edge.toNode, graph.nodes)
        graph.edges.push(op.edge)
      } else if (op.op === 'update' || op.op === 'style') {
        const element = known(op.id, [...graph.nodes, ...graph.edges])
        const patch = op.op === 'style' ? { styleAttributes: op.styleAttributes } : op.patch
        if ('id' in patch && patch.id !== op.id) throw new Error('An id cannot be changed')
        const merged = { ...element, ...patch }
        for (const key of ['abele', 'styleAttributes'] as const) {
          if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key]))
            merged[key] = { ...element[key], ...patch[key] }
        }
        if (graph.nodes.some((node) => node.id === op.id))
          graph.nodes[graph.nodes.findIndex((n) => n.id === op.id)] = nodeSchema.parse(merged)
        else graph.edges[graph.edges.findIndex((e) => e.id === op.id)] = edgeSchema.parse(merged)
      } else if (op.op === 'group') {
        unique(graph, op.id)
        const members = [...new Set(op.ids)].map((id) => known(id, graph.nodes))
        const box = bounds(members, 40)
        graph.nodes.push({
          id: op.id,
          type: 'group',
          label: op.label ?? op.id,
          ...box,
          abele: { parent: null },
        })
        for (const member of members) member.abele = { ...member.abele, parent: op.id }
      } else if (op.op === 'collapse') {
        const node = known(op.id, graph.nodes)
        if (node.type !== 'group') throw new Error('Only groups can collapse')
        node.collapsed = op.collapsed
      } else {
        known(op.id, [...graph.nodes, ...graph.edges])
        if (
          op.op === 'ungroup' &&
          !graph.nodes.some((node) => node.id === op.id && node.type === 'group')
        )
          throw new Error('Only groups can ungroup')
        const parents = parentsOf(graph)
        for (const node of graph.nodes)
          if (parents.get(node.id) === op.id)
            node.abele = { ...node.abele, parent: parents.get(op.id) ?? null }
        graph.nodes = graph.nodes.filter((n) => n.id !== op.id)
        graph.edges = graph.edges.filter(
          (e) => e.id !== op.id && e.fromNode !== op.id && e.toNode !== op.id
        )
      }
      checkEdges(graph)
    } catch (error) {
      throw new CanvasEditError(index, error)
    }
  }
  // Re-parse extensions and geometry after every operation succeeds.
  graph = cloneCanvas(graph)
  return { graph, needsLayout }
}
