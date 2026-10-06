/** Only native standard reference fields. Extension strings are opaque, including abele data. */
import { cloneCanvas, type CanvasGraph, type CanvasNode } from './model'
export interface CanvasReferenceRename {
  before: string
  after: string
}
export function renamedCanvasPath(path: string, rename: CanvasReferenceRename): string {
  return path === rename.before || path.startsWith(`${rename.before}/`)
    ? rename.after + path.slice(rename.before.length)
    : path
}
export function renameCanvasNodeReferences(
  node: CanvasNode,
  rename: CanvasReferenceRename
): CanvasNode {
  const next = { ...node }
  for (const key of node.type === 'file' ? ['file'] : node.type === 'group' ? ['background'] : []) {
    if (typeof next[key] === 'string') next[key] = renamedCanvasPath(next[key], rename)
  }
  return next
}
export function renameCanvasReferences(
  graph: CanvasGraph,
  renames: readonly CanvasReferenceRename[]
): CanvasGraph {
  const next = cloneCanvas(graph)
  next.nodes = next.nodes.map((node) => renames.reduce(renameCanvasNodeReferences, node))
  return next
}
export function nodeReferencesPath(node: CanvasNode, path: string, source = ''): boolean {
  const value = node.type === 'file' ? node.file : node.type === 'group' ? node.background : null
  if (typeof value === 'string' && (value === path || value.startsWith(`${path}/`))) return true
  // Text-link rewriting belongs to the host. Conservatively invalidate a matching link;
  // never rewrite prose, URLs, code or unknown extensions ourselves.
  if (node.type !== 'text' || typeof node.text !== 'string') return false
  const basename = path.split('/').pop()!.replace(/\.md$/, '')
  return [...node.text.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]|\]\(([^)]+)\)/g)].some((match) => {
    let link = (match[1] ?? match[2]).split('#')[0].replace(/^<|>$/g, '')
    try {
      link = decodeURIComponent(link)
    } catch {
      /* Keep malformed legacy links opaque. */
    }
    const parts = [...source.split('/').slice(0, -1)]
    for (const part of link.split('/')) {
      if (part === '..') parts.pop()
      else if (part && part !== '.') parts.push(part)
    }
    const relative = parts.join('/')
    return (
      [link, relative].some(
        (value) =>
          value === path || value === path.replace(/\.md$/, '') || value.startsWith(`${path}/`)
      ) || link === basename
    )
  })
}
