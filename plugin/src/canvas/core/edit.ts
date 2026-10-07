/** Batched semantic changes are validated on a clone; never partial writes. */
import { z } from 'zod'
import {
  bounds,
  cloneCanvas,
  edgeSchema,
  nodeSchema,
  parentsOf,
  recordParent,
  recordParents,
  SHAPES,
  type CanvasGraph,
  type CanvasEdge,
  type CanvasNode,
} from './model'
import { moveIds } from './selection'
import { lineSchema, linesOf, rawLines, writeLines, lineIds, type CanvasLine } from './primitives'

import {
  addInk,
  inkIds,
  inkSchema,
  allInkEntries,
  attachInk,
  inkBounds,
  replaceInk,
  transformInk,
  type CanvasInk,
  rawInk,
} from './ink'

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
  z
    .object({
      op: z.literal('move'),
      ids: z.array(id).min(1),
      dx: z.number().finite(),
      dy: z.number().finite(),
    })
    .strict(),
  z.object({ op: z.literal('connect'), edge: edgeSchema }).strict(),
  z.object({ op: z.literal('add_line'), line: lineSchema }).strict(),
  z.object({ op: z.literal('add_ink'), stroke: inkSchema, node: id.optional() }).strict(),
  z.object({ op: z.literal('update_ink'), id, patch: object }).strict(),
  z.object({ op: z.literal('attach_ink'), id, node: id.optional() }).strict(),
  z
    .object({
      op: z.literal('scale'),
      ids: z.array(id).min(1),
      x: z.number().finite(),
      y: z.number().finite(),
      factor: z.number().positive(),
    })
    .strict(),
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
function known<T extends { id: string }>(id: string, index: ReadonlyMap<string, T>): T {
  const found = index.get(id)
  if (found) return found
  const suggested = Array.from(index.values())
    .map((n) => ({ id: n.id, score: distance(id, n.id) }))
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))[0]
  throw new Error(
    `Unknown id ${id}${suggested && suggested.score <= Math.max(2, id.length / 3) ? `; did you mean ${suggested.id}?` : ''}`
  )
}
function unique(elements: ReadonlyMap<string, { id: string }>, id: string): void {
  if (elements.has(id)) throw new Error(`Duplicate id ${id}`)
}
function checkEdges(graph: CanvasGraph, nodes: ReadonlyMap<string, CanvasNode>): void {
  for (const edge of graph.edges) {
    known(edge.fromNode, nodes)
    known(edge.toNode, nodes)
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
  const nodes = new Map<string, CanvasNode>(),
    edges = new Map<string, CanvasEdge>(),
    elements = new Map<string, CanvasNode | CanvasEdge | CanvasLine | CanvasInk>(),
    lines = new Map<string, CanvasLine>()
  const rebuild = () => {
    nodes.clear()
    edges.clear()
    elements.clear()
    for (const node of graph.nodes) {
      nodes.set(node.id, node)
      elements.set(node.id, node)
    }
    for (const edge of graph.edges) {
      edges.set(edge.id, edge)
      elements.set(edge.id, edge)
    }
    lines.clear()
    for (const line of linesOf(graph)) {
      lines.set(line.id, line)
      elements.set(line.id, line)
    }
    for (const { stroke } of allInkEntries(graph)) elements.set(stroke.id, stroke)
  }
  const uniqueId = (id: string) => {
    unique(elements, id)
    if ([...lineIds(graph), ...inkIds(graph)].includes(id)) throw new Error(`Duplicate id ${id}`)
  }
  rebuild()
  for (let index = 0; index < ops.length; index++) {
    try {
      const op = operationSchema.parse(ops[index])
      if (op.op === 'add_node') {
        const n = op.node
        uniqueId(n.id)
        if ((n.x === undefined) !== (n.y === undefined))
          throw new Error('Provide both x and y, or neither')
        if (n.parent) {
          const parent = known(n.parent, nodes)
          if (parent.type !== 'group') throw new Error('Parent must be a group')
        }
        const near = n.near ? known(n.near, nodes) : undefined
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
        const added = nodeSchema.parse(node)
        graph.nodes.push(added)
        nodes.set(added.id, added)
        elements.set(added.id, added)
        recordParent(added, n.parent ?? null, graph)
        if (n.x === undefined && !near) needsLayout = true
        if (n.parent || type === 'group') parentsOf(graph)
      } else if (op.op === 'update_ink' || op.op === 'attach_ink') {
        const entry = allInkEntries(graph).find((e) => e.stroke.id === op.id)
        if (!entry) throw new Error(`Unknown ink ${op.id}`)
        if (op.op === 'attach_ink') attachInk(graph, entry, op.node)
        else {
          if ('id' in op.patch && op.patch.id !== op.id) throw new Error('An id cannot be changed')
          if ('frame' in op.patch || 'version' in op.patch)
            throw new Error('Use attach_ink to change attachment')
          replaceInk(graph, entry, [inkSchema.parse({ ...entry.stroke, ...op.patch })])
        }
        rebuild()
      } else if (op.op === 'move' || op.op === 'scale') {
        const entries = allInkEntries(graph),
          moving = moveIds(graph, new Set(op.ids)),
          parents = parentsOf(graph)
        for (const id of op.ids) {
          known(id, elements)
          if (edges.has(id)) throw new Error('Bound connections follow their nodes')
        }
        const factor = op.op === 'scale' ? op.factor : 1,
          x = op.op === 'scale' ? op.x : 0,
          y = op.op === 'scale' ? op.y : 0,
          dx = op.op === 'move' ? op.dx : 0,
          dy = op.op === 'move' ? op.dy : 0
        for (const entry of entries)
          if (op.ids.includes(entry.stroke.id) && (!entry.node || !moving.has(entry.node.id)))
            replaceInk(graph, entry, [transformInk(entry, x, y, factor, dx, dy)])
        if (op.ids.some((id) => lines.has(id))) {
          writeLines(
            graph,
            rawLines(graph, true).map((value) => {
              const line = lines.get((value as CanvasLine)?.id)
              return line && op.ids.includes(line.id)
                ? lineSchema.parse({
                    ...line,
                    from: {
                      x: x + (line.from.x - x) * factor + dx,
                      y: y + (line.from.y - y) * factor + dy,
                    },
                    to: {
                      x: x + (line.to.x - x) * factor + dx,
                      y: y + (line.to.y - y) * factor + dy,
                    },
                  })
                : value
            })
          )
        }
        for (const node of graph.nodes)
          if (moving.has(node.id)) {
            node.x = x + (node.x - x) * factor + dx
            node.y = y + (node.y - y) * factor + dy
            node.width *= factor
            node.height *= factor
          }
        // Update anchors only after all descendants moved. Never resolve a half-moved group.
        if (graph.nodes.some((node) => node.type === 'group')) recordParents(graph, parents)
        rebuild()
      } else if (op.op === 'connect') {
        uniqueId(op.edge.id)
        known(op.edge.fromNode, nodes)
        known(op.edge.toNode, nodes)
        graph.edges.push(op.edge)
        edges.set(op.edge.id, op.edge)
        elements.set(op.edge.id, op.edge)
      } else if (op.op === 'add_ink') {
        uniqueId(op.stroke.id)
        addInk(graph, op.stroke, op.node)
        rebuild()
      } else if (op.op === 'add_line') {
        uniqueId(op.line.id)
        writeLines(graph, [...rawLines(graph, true), op.line])
        rebuild()
      } else if (op.op === 'update' || op.op === 'style') {
        const element = known(op.id, elements)
        if (allInkEntries(graph).some((e) => e.stroke.id === op.id))
          throw new Error('Use update_ink for strokes')
        const patch = op.op === 'style' ? { styleAttributes: op.styleAttributes } : op.patch
        if ('id' in patch && patch.id !== op.id) throw new Error('An id cannot be changed')
        const merged = { ...element, ...patch }
        for (const key of ['abele', 'styleAttributes'] as const) {
          if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key]))
            merged[key] = {
              ...(element[key] && typeof element[key] === 'object'
                ? (element[key] as Record<string, unknown>)
                : {}),
              ...patch[key],
            }
        }
        if (nodes.has(op.id)) {
          const updated = nodeSchema.parse(merged)
          graph.nodes[graph.nodes.findIndex((n) => n.id === op.id)] = updated
          nodes.set(updated.id, updated)
          elements.set(updated.id, updated)
          if (
            op.op === 'update' &&
            patch.abele &&
            typeof patch.abele === 'object' &&
            'parent' in patch.abele
          )
            recordParent(updated, updated.abele?.parent as string | null, graph)
          if (op.op === 'update') parentsOf(graph)
        } else if (lines.has(op.id)) {
          const updated = lineSchema.parse(merged)
          writeLines(
            graph,
            rawLines(graph, true).map((value) =>
              (value as CanvasLine)?.id === op.id ? updated : value
            )
          )
          lines.set(op.id, updated)
          elements.set(op.id, updated)
        } else {
          const updated = edgeSchema.parse(merged)
          known(updated.fromNode, nodes)
          known(updated.toNode, nodes)
          graph.edges[graph.edges.findIndex((e) => e.id === op.id)] = updated
          edges.set(updated.id, updated)
          elements.set(updated.id, updated)
        }
      } else if (op.op === 'group') {
        uniqueId(op.id)
        const previous = parentsOf(graph)
        // Freeze ALL pre-existing memberships, including cards without Abele metadata.
        const existing = [...graph.nodes]
        const selected = [...new Set(op.ids)]
        for (const id of selected) known(id, elements)
        if (selected.some((id) => edges.has(id) || lines.has(id)))
          throw new Error('Group cards and ink only')
        const members = graph.nodes.filter((n) => selected.includes(n.id)),
          moving = moveIds(graph, new Set(members.map((n) => n.id))),
          ink = allInkEntries(graph).filter(
            (e) => selected.includes(e.stroke.id) && (!e.node || !moving.has(e.node.id))
          )
        const box = bounds([...members, ...ink.map(inkBounds)], 40)
        graph.nodes.push({
          id: op.id,
          type: 'group',
          label: op.label ?? op.id,
          ...box,
          abele: { parent: null },
        })
        for (const node of existing) recordParent(node, previous.get(node.id) ?? null, graph)
        recordParent(graph.nodes[graph.nodes.length - 1], null, graph)
        for (const member of members) recordParent(member, op.id, graph)
        for (const entry of ink) attachInk(graph, entry, op.id)
        rebuild()
        parentsOf(graph)
      } else if (op.op === 'collapse') {
        const node = known(op.id, nodes)
        if (node.type !== 'group') throw new Error('Only groups can collapse')
        node.collapsed = op.collapsed
      } else {
        known(op.id, elements)
        if (
          op.op === 'ungroup' &&
          !graph.nodes.some((node) => node.id === op.id && node.type === 'group')
        )
          throw new Error('Only groups can ungroup')
        if (lines.has(op.id))
          writeLines(
            graph,
            rawLines(graph, true).filter((value) => (value as CanvasLine)?.id !== op.id)
          )
        const ink = allInkEntries(graph).find((e) => e.stroke.id === op.id)
        if (ink) replaceInk(graph, ink, [])
        if (op.op === 'ungroup') {
          const owned = allInkEntries(graph).filter((e) => e.node?.id === op.id),
            raw = rawInk(known(op.id, nodes), true)
          if (raw.length !== owned.length)
            throw new Error('Cannot ungroup opaque ink without its attachment geometry')
          for (const entry of owned) attachInk(graph, entry)
        }
        const parents = parentsOf(graph)
        for (const node of graph.nodes)
          if (parents.get(node.id) === op.id) recordParent(node, parents.get(op.id) ?? null, graph)
        graph.nodes = graph.nodes.filter((n) => n.id !== op.id)
        graph.edges = graph.edges.filter(
          (e) => e.id !== op.id && e.fromNode !== op.id && e.toNode !== op.id
        )
        rebuild()
        parentsOf(graph)
      }
    } catch (error) {
      throw new CanvasEditError(index, error)
    }
  }
  // One full topology validation, with indexed endpoints, not one for every accumulated prefix.
  checkEdges(graph, nodes)
  // Re-parse extensions and geometry after every operation succeeds.
  graph = cloneCanvas(graph)
  return { graph, needsLayout }
}
