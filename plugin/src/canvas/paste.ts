/**
 * What a paste puts on the canvas, as one change: pictures and files already saved with the
 * vault's attachments stand as cards of their own, an address becomes a web page card, the
 * canvas's own copied cards come back as copies with their connections, and any other words
 * become a text card. Everything lands around the place it was pasted at.
 */
import { nanoid } from 'nanoid'
import type { CanvasOperation, NodeInput } from './core/edit'
import { bounds, parentsOf, type CanvasEdge, type CanvasNode } from './core/model'

export type Pasted =
  | { kind: 'files'; files: { path: string; width?: number; height?: number }[] }
  | { kind: 'text'; text: string }

/** The longest side a pasted picture takes on the canvas, as Obsidian Canvas sizes its own. */
const PICTURE_SIDE = 400
const GAP = 40

/** A picture's card keeps the picture's proportions; another file takes a note's size. */
function fileSize(file: { width?: number; height?: number }): { width: number; height: number } {
  if (!file.width || !file.height) return { width: 400, height: 300 }
  const scale = Math.min(1, PICTURE_SIDE / Math.max(file.width, file.height))
  return { width: Math.round(file.width * scale), height: Math.round(file.height * scale) }
}

/** Cards copied from a canvas, as its Copy writes them; anything else is not. */
function copiedCanvas(text: string): { nodes: CanvasNode[]; edges: CanvasEdge[] } | null {
  if (!/^\s*\{/.test(text)) return null
  try {
    const value = JSON.parse(text) as { nodes?: unknown; edges?: unknown }
    if (!Array.isArray(value.nodes) || !value.nodes.length) return null
    return {
      nodes: value.nodes as CanvasNode[],
      edges: Array.isArray(value.edges) ? (value.edges as CanvasEdge[]) : [],
    }
  } catch {
    return null
  }
}

/** The ops that put what was pasted around `at`, and the ids of what they make. */
export function pasteOps(
  pasted: Pasted,
  at: { x: number; y: number }
): { ops: CanvasOperation[]; ids: string[] } {
  if (pasted.kind === 'files') {
    const ops: CanvasOperation[] = [],
      ids: string[] = []
    let x = at.x
    for (const file of pasted.files) {
      const size = fileSize(file),
        id = nanoid()
      ops.push({
        op: 'add_node',
        node: {
          id,
          kind: 'note',
          file: file.path,
          x,
          y: Math.round(at.y - size.height / 2),
          ...size,
        },
      })
      ids.push(id)
      x += size.width + GAP
    }
    // The row of them stands with its middle where it was pasted.
    const shift = Math.round((x - GAP - at.x) / 2)
    for (const op of ops) if (op.op === 'add_node') op.node.x = (op.node.x ?? 0) - shift
    return { ops, ids }
  }
  const text = pasted.text.trim()
  const copied = copiedCanvas(text)
  if (copied) {
    const fresh = new Map(copied.nodes.map((n) => [n.id, nanoid()])),
      box = bounds(copied.nodes),
      dx = Math.round(at.x - (box.x + box.width / 2)),
      dy = Math.round(at.y - (box.y + box.height / 2)),
      parents = parentsOf({ nodes: copied.nodes, edges: copied.edges })
    const kind = (n: CanvasNode): NodeInput['kind'] =>
      n.type === 'file'
        ? 'note'
        : n.type === 'text' && n.styleAttributes?.shape
          ? 'shape'
          : (n.type as 'text' | 'link' | 'group')
    // Frames first, the largest first, so what is inside lands in its copy.
    const nodes = [...copied.nodes].sort(
      (a, b) =>
        Number(b.type === 'group') - Number(a.type === 'group') ||
        (a.type === 'group' && b.type === 'group' ? b.width * b.height - a.width * a.height : 0)
    )
    const ops: CanvasOperation[] = [
      ...nodes.map(
        (n): CanvasOperation => ({
          op: 'add_node',
          node: {
            id: fresh.get(n.id)!,
            kind: kind(n),
            ...(n.type === 'text' ? { label: n.text ?? '' } : {}),
            ...(n.type === 'group' ? { label: n.label ?? '' } : {}),
            ...(n.file ? { file: n.file } : {}),
            ...(n.subpath ? { subpath: n.subpath } : {}),
            ...(n.url ? { url: n.url } : {}),
            ...(typeof n.styleAttributes?.shape === 'string'
              ? { shape: n.styleAttributes.shape as never }
              : {}),
            ...(n.color ? { color: n.color } : {}),
            ...(fresh.has(parents.get(n.id) ?? '') ? { parent: fresh.get(parents.get(n.id)!) } : {}),
            x: n.x + dx,
            y: n.y + dy,
            width: n.width,
            height: n.height,
          },
        })
      ),
      ...copied.edges
        .filter((e) => fresh.has(e.fromNode) && fresh.has(e.toNode))
        .map(
          (e): CanvasOperation => ({
            op: 'connect',
            edge: {
              ...e,
              id: nanoid(),
              fromNode: fresh.get(e.fromNode)!,
              toNode: fresh.get(e.toNode)!,
            },
          })
        ),
    ]
    return { ops, ids: copied.nodes.map((n) => fresh.get(n.id)!) }
  }
  const id = nanoid()
  if (/^https?:\/\/\S+$/i.test(text))
    return {
      ops: [
        {
          op: 'add_node',
          node: {
            id,
            kind: 'link',
            url: text,
            x: at.x - 200,
            y: at.y - 150,
            width: 400,
            height: 300,
          },
        },
      ],
      ids: [id],
    }
  return {
    ops: [
      {
        op: 'add_node',
        node: {
          id,
          kind: 'text',
          label: text,
          x: at.x - 130,
          y: at.y - 80,
          width: 260,
          height: 160,
        },
      },
    ],
    ids: [id],
  }
}
