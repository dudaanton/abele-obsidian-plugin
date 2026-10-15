/**
 * Finding words on a canvas: in the text of its cards and shapes, the labels of its connections
 * and lines, the names of its frames, the names of the notes and files on it, and what those
 * notes say. What is found comes in reading order, top to bottom, then left to right.
 */
import type { CanvasGraph } from './model'
import { linesOf } from './primitives'
import { canvasVisibility } from './visibility'

export interface CanvasMatch {
  id: string
  /** Where it stands, for the camera to go to. */
  x: number
  y: number
}

export function findOnCanvas(
  graph: CanvasGraph,
  query: string,
  /** What each note on the canvas says, by card, as far as it is known. */
  contents: (id: string) => string | undefined = () => undefined
): CanvasMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const has = (text: unknown) => typeof text === 'string' && text.toLowerCase().includes(q)
  const found: CanvasMatch[] = []
  const { visible, hidden } = canvasVisibility(graph)
  for (const n of graph.nodes) {
    if (hidden.has(n.id) && !visible.includes(n)) continue
    const name = n.file?.split('/').pop()?.replace(/\.md$/, '')
    if (has(n.text) || has(n.label) || has(name) || has(n.url) || has(contents(n.id)))
      found.push({ id: n.id, x: n.x, y: n.y })
  }
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]))
  for (const e of graph.edges) {
    if (!has(e.label)) continue
    const a = nodes.get(e.fromNode),
      b = nodes.get(e.toNode)
    if (a && b) found.push({ id: e.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  }
  for (const l of linesOf(graph))
    if (has(l.label)) found.push({ id: l.id, x: (l.from.x + l.to.x) / 2, y: (l.from.y + l.to.y) / 2 })
  return found.sort((a, b) => a.y - b.y || a.x - b.x)
}
