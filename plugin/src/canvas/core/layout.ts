import { z } from 'zod'
import { dagreLayout, type LayeredLayout, type LayoutInput } from './dagre'
import {
  bounds,
  cloneCanvas,
  descendants,
  parentsOf,
  type CanvasGraph,
  type CanvasNode,
  type Rect,
} from './model'
export const layoutOptionsSchema = z
  .object({
    algorithm: z.enum(['layered', 'tree', 'radial', 'grid']).default('layered'),
    direction: z.enum(['LR', 'RL', 'TB', 'BT']).default('LR'),
    scope: z.string().optional(),
    keep: z.array(z.string()).default([]),
    gap: z.number().positive().default(80),
  })
  .strict()
export type LayoutOptions = z.input<typeof layoutOptionsSchema>
function simpleLayout(
  input: LayoutInput,
  algorithm: 'grid' | 'radial' | 'tree'
): Map<string, Rect> {
  const out = new Map<string, Rect>(),
    nodes = input.nodes
  if (!nodes.length) return out
  const w = Math.max(...nodes.map((n) => n.width)) + input.gap,
    h = Math.max(...nodes.map((n) => n.height)) + input.gap
  const columns = Math.ceil(Math.sqrt(nodes.length))
  const depths = new Map<string, number>()
  if (algorithm === 'tree') {
    const roots = nodes.filter((n) => !input.edges.some((e) => e.to === n.id && e.from !== n.id))
    const queue = (roots.length ? roots : [nodes[0]]).map((n) => n.id)
    queue.forEach((id) => depths.set(id, 0))
    for (let i = 0; i < queue.length; i++)
      for (const edge of input.edges.filter((e) => e.from === queue[i])) {
        if (depths.has(edge.to)) continue
        depths.set(edge.to, depths.get(queue[i]) + 1)
        queue.push(edge.to)
      }
    for (const n of nodes) if (!depths.has(n.id)) depths.set(n.id, 0)
  }
  const rows = new Map<number, number>()
  const radius = Math.max(w, h) * Math.max(1, nodes.length / Math.PI)
  nodes.forEach((n, i) => {
    let x = (i % columns) * w,
      y = Math.floor(i / columns) * h
    if (algorithm === 'radial') {
      const angle = (i * 2 * Math.PI) / nodes.length
      x = radius + Math.cos(angle) * radius
      y = radius + Math.sin(angle) * radius
    }
    if (algorithm === 'tree') {
      const depth = depths.get(n.id)
      const row = rows.get(depth) ?? 0
      rows.set(depth, row + 1)
      x = depth * w
      y = row * h
    }
    if (input.direction === 'TB' || input.direction === 'BT') [x, y] = [y, x]
    if (input.direction === 'RL') x = -x
    if (input.direction === 'BT') y = -y
    out.set(n.id, { x, y, width: n.width, height: n.height })
  })
  return out
}
/** Lay out each hierarchy level independently, so cross-cluster edges never crash dagre. */
export function layoutCanvas(
  input: CanvasGraph,
  raw: LayoutOptions = {},
  layered: LayeredLayout = dagreLayout
): CanvasGraph {
  const options = layoutOptionsSchema.parse(raw),
    graph = cloneCanvas(input),
    parents = parentsOf(graph)
  const fixed = new Set(options.keep),
    nodes = new Map(graph.nodes.map((n) => [n.id, n]))
  for (const id of fixed) if (!nodes.has(id)) throw new Error(`Unknown keep id: ${id}`)
  for (const id of options.keep) for (const child of descendants(id, parents)) fixed.add(child)
  if (options.scope && nodes.get(options.scope)?.type !== 'group')
    throw new Error(`Unknown scope group: ${options.scope}`)
  // Freeze inferred native membership in our portable extension before geometry changes.
  for (const n of graph.nodes) n.abele = { ...n.abele, parent: parents.get(n.id) ?? null }
  const shift = (node: CanvasNode, dx: number, dy: number) => {
    const ids = [node.id, ...descendants(node.id, parents)]
    if (ids.some((id) => fixed.has(id))) return
    for (const id of ids) {
      const child = nodes.get(id)
      child.x += dx
      child.y += dy
    }
  }
  const arrange = (parent?: string) => {
    const children = graph.nodes
      .filter((n) => parents.get(n.id) === parent)
      .sort((a, b) => a.id.localeCompare(b.id))
    for (const child of children) if (child.type === 'group') arrange(child.id)
    if (!children.length) return
    const container = parent ? nodes.get(parent) : undefined
    const origin = container ? { x: container.x + 40, y: container.y + 60 } : { x: 0, y: 0 }
    const ids = new Set(children.map((n) => n.id))
    const representative = (id: string): string | undefined => {
      while (nodes.has(id)) {
        if (ids.has(id)) return id
        const next = parents.get(id)
        if (!next) return
        id = next
      }
    }
    const edges = graph.edges.flatMap((e) => {
      const from = representative(e.fromNode),
        to = representative(e.toNode)
      return from && to && from !== to ? [{ from, to }] : []
    })
    const port: LayoutInput = {
      nodes: children.map((n) => ({ id: n.id, width: n.width, height: n.height })),
      edges,
      direction: options.direction,
      gap: options.gap,
    }
    const positioned =
      options.algorithm === 'layered' ? layered(port) : simpleLayout(port, options.algorithm)
    // Fixed nodes remain exactly in place; movable siblings are placed away from fixed rectangles.
    const occupied: Rect[] = children.filter((n) =>
      [n.id, ...descendants(n.id, parents)].some((id) => fixed.has(id))
    )
    for (const child of children) {
      if (occupied.includes(child)) continue
      const pos = positioned.get(child.id)
      let target = { ...pos, x: pos.x + origin.x, y: pos.y + origin.y }
      while (
        occupied.some(
          (r) =>
            target.x < r.x + r.width + options.gap &&
            target.x + target.width + options.gap > r.x &&
            target.y < r.y + r.height + options.gap &&
            target.y + target.height + options.gap > r.y
        )
      ) {
        target = { ...target, y: Math.max(...occupied.map((r) => r.y + r.height)) + options.gap }
      }
      shift(child, target.x - child.x, target.y - child.y)
      occupied.push(child)
    }
    if (container && !fixed.has(container.id)) {
      const box = bounds(children, 40)
      Object.assign(container, { ...box, y: box.y - 20, height: box.height + 20 })
    }
  }
  arrange(options.scope)
  return graph
}
