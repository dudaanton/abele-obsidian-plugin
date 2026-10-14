/**
 * Copies of picked things as one batch of edits: cards, frames with what is inside them, the
 * connections among them, free lines and strokes, and the ink drawn on any card that is copied.
 * Used by Duplicate, by Alt-dragging, and by pasting what was copied, on this canvas or another.
 */
import { nanoid } from 'nanoid'
import type { CanvasOperation } from './edit'
import { parentsOf, type CanvasGraph, type CanvasNode, type Shape } from './model'
import { moveIds } from './selection'
import { allInkEntries, inkInWorld, inkTransform } from './ink'
import { linesOf } from './primitives'

/** What a copy holds, as a canvas of its own: Obsidian Canvas's JSON with our extensions. */
export type CanvasClip = Pick<CanvasGraph, 'nodes' | 'edges' | 'abele'>

/** The picked things, with what frames hold, as a canvas of their own to copy or put on the clipboard. */
export function clipOf(graph: CanvasGraph, ids: ReadonlySet<string>): CanvasClip {
  const nodes = moveIds(
    graph,
    new Set([...ids].filter((id) => graph.nodes.some((n) => n.id === id)))
  )
  const ink = allInkEntries(graph)
    // A stroke picked on a card that is not copied comes along as free ink where it stands.
    .filter((e) => ids.has(e.stroke.id) && (!e.node || !nodes.has(e.node.id)))
    .map((e) => (e.node ? inkInWorld(e) : e.stroke))
  const lines = linesOf(graph).filter((l) => ids.has(l.id))
  return {
    nodes: graph.nodes.filter((n) => nodes.has(n.id)),
    edges: graph.edges.filter((e) => nodes.has(e.fromNode) && nodes.has(e.toNode)),
    abele: { ...(ink.length ? { ink } : {}), ...(lines.length ? { lines } : {}) },
  }
}

const kindOf = (n: CanvasNode) =>
  n.type === 'file'
    ? ('note' as const)
    : n.type === 'text' && n.styleAttributes?.shape
      ? ('shape' as const)
      : n.type

/**
 * Edits that put a copy of a clip on a canvas, moved by dx, dy, with fresh ids: frames before
 * what they hold, an outer frame before an inner one, then connections, lines and ink. The ids
 * the copies of the clip's top-level things get come back too, to pick them.
 */
export function copyOps(
  clip: CanvasClip,
  dx: number,
  dy: number
): { ops: CanvasOperation[]; picked: Set<string> } {
  const graph: CanvasGraph = { nodes: clip.nodes, edges: clip.edges, abele: clip.abele }
  const parents = parentsOf(graph),
    fresh = new Map(clip.nodes.map((n) => [n.id, nanoid()]))
  const nodes = [...clip.nodes].sort(
    (a, b) =>
      Number(b.type === 'group') - Number(a.type === 'group') ||
      (a.type === 'group' && b.type === 'group' ? b.width * b.height - a.width * a.height : 0)
  )
  const picked = new Set<string>()
  const ops: CanvasOperation[] = nodes.map((n) => {
    const parent = parents.get(n.id)
    if (!parent || !fresh.has(parent)) picked.add(fresh.get(n.id))
    return {
      op: 'add_node',
      node: {
        id: fresh.get(n.id),
        kind: kindOf(n),
        ...(n.type === 'text' ? { label: n.text ?? '' } : {}),
        ...(n.type === 'group' ? { label: n.label ?? '' } : {}),
        ...(n.file ? { file: n.file } : {}),
        ...(n.subpath ? { subpath: n.subpath } : {}),
        ...(n.url ? { url: n.url } : {}),
        ...(n.styleAttributes?.shape ? { shape: n.styleAttributes.shape as Shape } : {}),
        ...(n.color ? { color: n.color } : {}),
        ...(parent && fresh.has(parent) ? { parent: fresh.get(parent) } : {}),
        x: n.x + dx,
        y: n.y + dy,
        width: n.width,
        height: n.height,
      },
    }
  })
  for (const e of clip.edges)
    if (fresh.has(e.fromNode) && fresh.has(e.toNode))
      ops.push({
        op: 'connect',
        edge: {
          ...e,
          id: nanoid(),
          fromNode: fresh.get(e.fromNode),
          toNode: fresh.get(e.toNode),
        },
      })
  for (const line of linesOf(graph)) {
    const id = nanoid()
    picked.add(id)
    ops.push({
      op: 'add_line',
      line: {
        ...line,
        id,
        from: { x: line.from.x + dx, y: line.from.y + dy },
        to: { x: line.to.x + dx, y: line.to.y + dy },
      },
    })
  }
  for (const entry of allInkEntries(graph)) {
    const id = nanoid()
    if (entry.node) {
      // Ink on a card goes with the card's copy, where it stands on that card.
      if (!fresh.has(entry.node.id)) continue
      ops.push({ op: 'add_ink', stroke: { ...entry.stroke, id }, node: fresh.get(entry.node.id) })
    } else {
      const t = inkTransform(entry)
      picked.add(id)
      ops.push({
        op: 'add_ink',
        stroke: { ...entry.stroke, id, transform: { ...t, x: t.x + dx, y: t.y + dy } },
      })
    }
  }
  return { ops, picked }
}

/** A clip read back from the clipboard: Obsidian Canvas's JSON, ours or the native one. */
export function parseClip(text: string): CanvasClip | null {
  try {
    const value = JSON.parse(text) as Partial<CanvasClip>
    if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges ?? [])) return null
    if (!value.nodes.every((n) => n && typeof n.id === 'string' && typeof n.x === 'number'))
      return null
    return { nodes: value.nodes, edges: value.edges ?? [], abele: value.abele }
  } catch {
    return null
  }
}
