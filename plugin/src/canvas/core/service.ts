import { z } from 'zod'
import { editCanvas, inputNodeSchema } from './edit'
import {
  cloneCanvas,
  descendants,
  parentsOf,
  recordParents,
  edgeSchema,
  emptyCanvas,
  type CanvasGraph,
  type CanvasNode,
} from './model'
import { layoutOptionsSchema, layoutCanvas, type LayoutOptions } from './layout'
import { fitText, type TextMetricsPort } from './scene'

function fitForLayout(
  graph: CanvasGraph,
  metrics?: TextMetricsPort,
  selected?: (node: CanvasNode) => boolean
): CanvasGraph {
  const parents = parentsOf(graph),
    prepared = cloneCanvas(graph)
  recordParents(prepared, parents)
  const fitted = fitText(prepared, metrics, selected)
  recordParents(fitted, parents)
  return fitted
}

/** Portable effective graph and write revision; persisted bytes stay in the host adapter. */
export interface GraphSnapshot {
  graph: CanvasGraph
  revision: string
}
export interface GraphStore {
  snapshot(key: string): Promise<GraphSnapshot>
  read(key: string): Promise<CanvasGraph>
  create(key: string, graph: CanvasGraph, signal?: AbortSignal): Promise<void>
  change(
    key: string,
    revision: string,
    transform: (graph: CanvasGraph) => CanvasGraph,
    signal?: AbortSignal
  ): Promise<{ before: CanvasGraph; after: CanvasGraph; revision: string }>
}
export const graphInputSchema = z
  .object({
    nodes: z.array(inputNodeSchema),
    edges: z.array(edgeSchema).default([]),
    abele: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export interface MermaidGraph {
  nodes: { id: string; label: string; shape?: string }[]
  edges: {
    id: string
    fromNode: string
    toNode: string
    label?: string
    fromEnd?: 'none' | 'arrow'
    toEnd?: 'none' | 'arrow'
  }[]
  groups: { id: string; label: string; ids: string[] }[]
}
export interface MermaidPort {
  read(source: string): Promise<MermaidGraph>
}
export async function createCanvasGraph(
  from: unknown,
  title: string,
  mermaid?: MermaidPort,
  metrics?: TextMetricsPort
): Promise<CanvasGraph> {
  const source = z
    .union([
      z.object({ graph: graphInputSchema }).strict(),
      z.object({ mermaid: z.string().min(1) }).strict(),
    ])
    .parse(from)
  let graph: CanvasGraph
  if ('mermaid' in source) {
    if (!mermaid) throw new Error('Mermaid import is not available in this host')
    const parsed = await mermaid.read(source.mermaid)
    graph = editCanvas(
      emptyCanvas(),
      parsed.nodes.map((n) => ({
        op: 'add_node',
        node: { id: n.id, kind: 'shape', label: n.label, shape: n.shape ?? 'rectangle' },
      }))
    ).graph
    // Mermaid subgraphs may be nested; create inner groups before their parents.
    const remaining = [...parsed.groups]
    while (remaining.length) {
      const i = remaining.findIndex((g) =>
        g.ids.every((id) => graph.nodes.some((n) => n.id === id))
      )
      if (i < 0) throw new Error('Mermaid group membership could not be resolved')
      const [g] = remaining.splice(i, 1)
      if (g.ids.length)
        graph = editCanvas(graph, [{ op: 'group', id: g.id, label: g.label, ids: g.ids }]).graph
      else
        graph = editCanvas(graph, [
          { op: 'add_node', node: { id: g.id, kind: 'group', label: g.label } },
        ]).graph
    }
    if (parsed.edges.length)
      graph = editCanvas(
        graph,
        parsed.edges.map((e) => ({ op: 'connect', edge: e }))
      ).graph
  } else {
    const input = source.graph
    graph = input.nodes.length
      ? editCanvas(
          emptyCanvas(),
          input.nodes.map(({ parent: _parent, ...node }) => ({ op: 'add_node', node }))
        ).graph
      : emptyCanvas()
    const memberships = input.nodes
      .filter((n) => n.parent)
      .map((n) => ({ op: 'update', id: n.id, patch: { abele: { parent: n.parent } } }))
    if (memberships.length) graph = editCanvas(graph, memberships).graph
    if (input.edges.length)
      graph = editCanvas(
        graph,
        input.edges.map((edge) => ({ op: 'connect', edge }))
      ).graph
    if (input.abele) graph.abele = input.abele
  }
  graph.metadata = { frontmatter: { title } }
  return layoutCanvas(fitForLayout(graph, metrics), {})
}
export function planCanvasEdit(
  graph: CanvasGraph,
  ops: unknown,
  metrics?: TextMetricsPort
): CanvasGraph {
  const edited = editCanvas(graph, ops)
  return edited.needsLayout ? layoutCanvas(fitForLayout(edited.graph, metrics), {}) : edited.graph
}
export function planCanvasLayout(
  graph: CanvasGraph,
  options: LayoutOptions,
  metrics?: TextMetricsPort
): CanvasGraph {
  const parsed = layoutOptionsSchema.parse(options),
    parents = parentsOf(graph)
  const fixed = new Set(parsed.keep.flatMap((id) => [id, ...descendants(id, parents)]))
  const selected = parsed.scope ? new Set(descendants(parsed.scope, parents)) : null
  const fitted = fitForLayout(
    graph,
    metrics,
    (node) => !fixed.has(node.id) && (!selected || selected.has(node.id))
  )
  return layoutCanvas(fitted, parsed)
}
