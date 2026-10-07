import { contains, descendants, labelOf, overlaps, parentsOf, type CanvasGraph } from './model'
import { expandedNodeIds, stepsOf } from './steps'
import { linesOf } from './primitives'
import { allInkEntries } from './ink'
import {
  contentBox,
  defaultMetrics,
  paintedRoute,
  paintedRouteHits,
  textHeight,
  textLines,
  type TextMetricsPort,
} from './scene'
export interface CanvasWarning {
  code: string
  ids: string[]
  message: string
}
export function lintCanvas(
  graph: CanvasGraph,
  metrics: TextMetricsPort = defaultMetrics,
  contents: ReadonlyMap<string, string> = new Map()
): CanvasWarning[] {
  const warnings: CanvasWarning[] = [],
    parents = parentsOf(graph),
    connected = new Set<string>()
  const add = (code: string, ids: string[], message: string) =>
    warnings.push({ code, ids, message })
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id))
  const below = new Map(nodes.map((node) => [node.id, new Set(descendants(node.id, parents))]))
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    const parent = nodes.find((n) => n.id === parents.get(a.id))
    if (parent && !contains(parent, a))
      add('group-clipping', [a.id, parent.id], `${a.id} extends outside ${parent.id}`)
    for (const b of nodes.slice(i + 1)) {
      if (below.get(a.id)!.has(b.id) || below.get(b.id)!.has(a.id)) continue
      if (overlaps(a, b)) add('overlap', [a.id, b.id], `${a.id} overlaps ${b.id}`)
    }
    const box = contentBox(a),
      text = contents.get(a.id) ?? labelOf(a),
      lines = textLines(text, box.width, metrics)
    if (
      a.type !== 'group' &&
      (textHeight(lines, metrics) > box.height + 0.5 ||
        lines.some((line) => line.width > box.width + 0.5))
    )
      add('clipped-text', [a.id], `${a.id}: text exceeds its content box`)
  }
  for (const edge of [...graph.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    connected.add(edge.fromNode)
    connected.add(edge.toNode)
    const route = paintedRoute(edge, graph)
    if (!route.points.length) {
      add('missing-edge-node', [edge.id], `${edge.id}: missing endpoint`)
      continue
    }
    for (const node of nodes) {
      if (node.type === 'group' || node.id === edge.fromNode || node.id === edge.toNode) continue
      if (paintedRouteHits(route, node))
        add('edge-crossing', [edge.id, node.id], `${edge.id} crosses ${node.id}`)
    }
  }
  for (const node of nodes)
    if (node.type !== 'group' && !connected.has(node.id))
      add('isolated', [node.id], `${node.id} has no connection`)
  const ids = new Set(
    [
      ...graph.nodes,
      ...graph.edges,
      ...linesOf(graph),
      ...allInkEntries(graph).map((e) => e.stroke),
    ].map((n) => n.id)
  )
  const steps = graph.abele?.steps
  try {
    stepsOf(graph)
  } catch (error) {
    add('invalid-step', [], error instanceof Error ? error.message : String(error))
  }
  const previously = new Set<string>()
  if (Array.isArray(steps))
    steps.forEach((step: unknown, i) => {
      if (!step || typeof step !== 'object') {
        add('invalid-step', [], `Step ${i}: expected an object`)
        return
      }
      const data = step as Record<string, unknown>
      const reveal = Array.isArray(data.reveal) ? data.reveal : []
      const refs = [
        ...reveal,
        ...(Array.isArray(data.highlight) ? data.highlight : []),
        ...(typeof data.focus === 'string' ? [data.focus] : []),
      ]
      for (const id of refs)
        if (typeof id !== 'string' || !ids.has(id))
          add('missing-step-id', [String(id)], `Step ${i}: missing id ${String(id)}`)
      const newNodes = [
        ...expandedNodeIds(
          graph,
          reveal.filter((id): id is string => typeof id === 'string')
        ),
      ].filter(
        (id) => !previously.has(id) && graph.nodes.find((n) => n.id === id)?.type !== 'group'
      )
      newNodes.forEach((id) => previously.add(id))
      if (reveal.length > 7 || newNodes.length > 7)
        add(
          'dense-step',
          reveal.map(String),
          `Step ${i + 1} reveals ${Math.max(reveal.length, newNodes.length)} elements; aim for at most seven`
        )
    })
  return warnings
}
