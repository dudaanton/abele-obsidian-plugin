/** Replaceable layered-layout port; an opt-in engine can implement this later. */
import { Graph, layout } from '@dagrejs/dagre'
import type { Rect } from './model'
export interface LayoutInput {
  nodes: { id: string; width: number; height: number }[]
  edges: { from: string; to: string }[]
  direction: 'LR' | 'RL' | 'TB' | 'BT'
  gap: number
}
export type LayeredLayout = (input: LayoutInput) => Map<string, Rect>
export const dagreLayout: LayeredLayout = (input) => {
  const graph = new Graph({ multigraph: true })
  graph.setGraph({
    rankdir: input.direction,
    nodesep: input.gap,
    ranksep: input.gap * 1.5,
    marginx: 0,
    marginy: 0,
  })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const n of input.nodes) graph.setNode(n.id, { width: n.width, height: n.height })
  input.edges.forEach((e, i) => graph.setEdge(e.from, e.to, {}, String(i)))
  layout(graph)
  return new Map(
    input.nodes.map((n) => {
      const p = graph.node(n.id)
      return [
        n.id,
        { x: p.x - n.width / 2, y: p.y - n.height / 2, width: n.width, height: n.height },
      ]
    })
  )
}
