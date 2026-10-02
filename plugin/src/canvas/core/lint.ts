import { descendants, labelOf, overlaps, parentsOf, type CanvasGraph } from './model'
import {
  contentBox,
  defaultMetrics,
  routeEdge,
  segmentHits,
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
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (const b of nodes.slice(i + 1)) {
      if (descendants(a.id, parents).includes(b.id) || descendants(b.id, parents).includes(a.id))
        continue
      if (overlaps(a, b)) add('overlap', [a.id, b.id], `${a.id} overlaps ${b.id}`)
    }
    const box = contentBox(a),
      text = contents.get(a.id) ?? labelOf(a)
    if (
      a.type !== 'group' &&
      textHeight(textLines(text, box.width, metrics), metrics) > box.height + 0.5
    )
      add('clipped-text', [a.id], `${a.id}: text exceeds its content box`)
  }
  for (const edge of [...graph.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    connected.add(edge.fromNode)
    connected.add(edge.toNode)
    const points = routeEdge(edge, graph)
    if (!points.length) {
      add('missing-edge-node', [edge.id], `${edge.id}: missing endpoint`)
      continue
    }
    for (const node of nodes) {
      if (node.type === 'group' || node.id === edge.fromNode || node.id === edge.toNode) continue
      if (points.slice(1).some((b, i) => segmentHits(points[i], b, node)))
        add('edge-crossing', [edge.id, node.id], `${edge.id} crosses ${node.id}`)
    }
  }
  for (const node of nodes)
    if (node.type !== 'group' && !connected.has(node.id))
      add('isolated', [node.id], `${node.id} has no connection`)
  const ids = new Set([...graph.nodes, ...graph.edges].map((n) => n.id))
  const steps = graph.abele?.steps
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
      if (reveal.length > 7)
        add(
          'dense-step',
          reveal.map(String),
          `Step ${i} reveals ${reveal.length} elements; aim for at most seven`
        )
    })
  return warnings
}
