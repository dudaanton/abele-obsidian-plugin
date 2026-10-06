/** Host-independent picking and geometry for the human canvas editor. */
import { parentsOf, type CanvasGraph, type CanvasNode, type Rect } from './model'
import { canvasVisibility } from './visibility'

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'
export const RESIZE_CORNERS: ResizeCorner[] = ['nw', 'ne', 'sw', 'se']
export function cornerPoint(rect: Rect, corner: ResizeCorner): [number, number] {
  return [
    rect.x + (corner.endsWith('e') ? rect.width : 0),
    rect.y + (corner.startsWith('s') ? rect.height : 0),
  ]
}
export function hitNode(graph: CanvasGraph, x: number, y: number): CanvasNode | null {
  return (
    canvasVisibility(graph)
      .visible.reverse()
      .find((n) => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height) ?? null
  )
}
/** Targets are in screen pixels, independent of the camera scale. */
export function hitResize(
  node: Rect,
  x: number,
  y: number,
  zoom: number,
  touch: boolean
): ResizeCorner | null {
  const radius = (touch ? 22 : 12) / zoom
  return (
    RESIZE_CORNERS.find((corner) => {
      const [cx, cy] = cornerPoint(node, corner)
      return Math.abs(x - cx) <= radius && Math.abs(y - cy) <= radius
    }) ?? null
  )
}
export function selectNode(
  selected: ReadonlySet<string>,
  id: string | null,
  multiple: boolean
): Set<string> {
  if (!id) return multiple ? new Set(selected) : new Set()
  if (!multiple) return new Set([id])
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
export function nodesInBox(graph: CanvasGraph, box: Rect): string[] {
  return canvasVisibility(graph)
    .visible.filter(
      (n) =>
        n.x >= box.x &&
        n.y >= box.y &&
        n.x + n.width <= box.x + box.width &&
        n.y + n.height <= box.y + box.height
    )
    .map((n) => n.id)
}
export function moveIds(graph: CanvasGraph, ids: ReadonlySet<string>): Set<string> {
  const parents = parentsOf(graph),
    result = new Set(ids)
  for (const [child, parent] of parents) {
    let ancestor: string | undefined = parent
    while (ancestor) {
      if (ids.has(ancestor)) {
        result.add(child)
        break
      }
      ancestor = parents.get(ancestor)
    }
  }
  return result
}
/** A detached transient preview, not a mutation or a history command. */
export function movePreview(
  graph: CanvasGraph,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number
): CanvasGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
  }
}
export function resizeRect(node: Rect, corner: ResizeCorner, dx: number, dy: number): Rect {
  const west = corner.endsWith('w'),
    north = corner.startsWith('n'),
    width = Math.max(40, node.width + (west ? -dx : dx)),
    height = Math.max(40, node.height + (north ? -dy : dy))
  return {
    x: west ? node.x + node.width - width : node.x,
    y: north ? node.y + node.height - height : node.y,
    width,
    height,
  }
}
