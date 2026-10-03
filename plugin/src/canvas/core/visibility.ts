/** Shared visible-node plan for painting, live contents, asset reads and hit-testing. */
import {
  canvasPaintOrder,
  descendants,
  overlaps,
  parentsOf,
  type CanvasGraph,
  type Rect,
} from './model'
export function canvasVisibility(graph: CanvasGraph, region?: Rect) {
  const parents = parentsOf(graph)
  const hidden = new Set(
    graph.nodes
      .filter((node) => node.type === 'group' && node.collapsed)
      .flatMap((node) => descendants(node.id, parents))
  )
  const visible = canvasPaintOrder(graph).filter(
    (node) => !hidden.has(node.id) && (!region || overlaps(node, region))
  )
  return { parents, hidden, visible }
}
