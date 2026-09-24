/**
 * A repository's files as a tree, built from the flat list GitHub's trees API answers with, and
 * the links that climb from a file to its folders.
 *
 * Nothing here asks GitHub anything: `repoTree.ts` reads the list, `folder.ts` one folder.
 */
import { repoWeb } from '../origin'

/** One entry of the trees API: `blob` a file, `tree` a folder, `commit` a submodule. */
export interface TreeEntry {
  path: string
  type: string
  size?: number
  sha?: string
}

export type NodeKind = 'dir' | 'file' | 'submodule'

export interface TreeNode {
  name: string
  /** From the repository's root, without a leading slash; empty for the root itself. */
  path: string
  kind: NodeKind
  size?: number
  /** The git object: for a folder read lazily, the tree its children are asked by. */
  sha?: string
  /** A folder's entries, folders first; unset while they have not been read. */
  children?: TreeNode[]
}

interface RepoLike {
  host: string
  owner: string
  repo: string
}

const encodePath = (path: string) =>
  path.split('/').filter(Boolean).map(encodeURIComponent).join('/')

/** A folder at a ref — the repository's root for an empty path. The ref keeps its slashes. */
export function treeUrl(repo: RepoLike, ref: string, path: string): string {
  const folder = encodePath(path)
  return `${repoWeb(repo)}/tree/${encodePath(ref)}${folder ? `/${folder}` : ''}`
}

/** A file at a ref. */
export function blobUrlAt(repo: RepoLike, ref: string, path: string): string {
  return `${repoWeb(repo)}/blob/${encodePath(ref)}/${encodePath(path)}`
}

export interface Crumb {
  label: string
  /** Where it leads; unset for the owner, which no tab shows, and for the place shown. */
  url?: string
}

/**
 * `owner / repo / dir / sub / name`: every folder above `path` — and the repository's root — a
 * link to its listing at the same ref. The last part is what is shown, and is not a link.
 */
export function crumbs(repo: RepoLike, ref: string, path: string): Crumb[] {
  const parts = path.split('/').filter(Boolean)
  const out: Crumb[] = [{ label: repo.owner }]
  out.push(parts.length ? { label: repo.repo, url: treeUrl(repo, ref, '') } : { label: repo.repo })
  parts.forEach((part, i) => {
    const last = i === parts.length - 1
    out.push(
      last
        ? { label: part }
        : { label: part, url: treeUrl(repo, ref, parts.slice(0, i + 1).join('/')) }
    )
  })
  return out
}

const KIND_OF: Record<string, NodeKind> = { blob: 'file', tree: 'dir', commit: 'submodule' }

const RANK: Record<NodeKind, number> = { dir: 0, submodule: 1, file: 2 }

/** Folders first, then submodules, then files, each by name as a person reads it. */
export function sortNodes<T extends { kind: NodeKind; name: string }>(nodes: T[]): T[] {
  return nodes.sort(
    (a, b) =>
      RANK[a.kind] - RANK[b.kind] ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** A node for an entry; a folder with its children still to be read has none. */
export function nodeOf(entry: TreeEntry, path = entry.path): TreeNode {
  return {
    name: nameOf(path),
    path,
    kind: KIND_OF[entry.type] ?? 'file',
    size: entry.size,
    sha: entry.sha,
  }
}

/**
 * The whole tree from a recursive listing. A folder GitHub names only through the files in it
 * is made all the same; every folder's children are set, so none is read again.
 */
export function buildTree(entries: TreeEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', kind: 'dir', children: [] }
  const dirs = new Map<string, TreeNode>([['', root]])

  const dir = (path: string): TreeNode => {
    const known = dirs.get(path)
    if (known) return known
    const node: TreeNode = { name: nameOf(path), path, kind: 'dir', children: [] }
    dirs.set(path, node)
    const parent = dir(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
    parent.children.push(node)
    return node
  }

  for (const entry of entries) {
    if (entry.type === 'tree') {
      const node = dir(entry.path)
      node.sha = entry.sha
      continue
    }
    const at = entry.path.lastIndexOf('/')
    dir(at < 0 ? '' : entry.path.slice(0, at)).children.push(nodeOf(entry))
  }
  for (const node of dirs.values()) sortNodes(node.children)
  return root
}

/** A folder's entries from a listing of that folder alone, whose paths are names. */
export function childrenFrom(parent: string, entries: TreeEntry[]): TreeNode[] {
  return sortNodes(
    entries.map((e) => nodeOf(e, parent ? `${parent}/${nameOf(e.path)}` : nameOf(e.path)))
  )
}

/** The folders above a path, outermost first. */
export function ancestors(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

/** The node at a path, as far as the tree has been read. */
export function findNode(root: TreeNode, path: string): TreeNode | null {
  let node: TreeNode | undefined = root
  for (const part of path.split('/').filter(Boolean)) {
    node = node?.children?.find((c) => c.name === part)
    if (!node) return null
  }
  return node ?? null
}

export interface Filtered {
  /** The tree cut down to what matched and the folders leading to it. */
  root: TreeNode
  matches: number
  /** Stopped at the limit: there are more. */
  capped: boolean
  /** The folders to show open: every one on the way to a match. */
  open: string[]
}

/**
 * The entries whose name holds the query, letter case aside, with the folders on the way to them.
 * A folder that matches keeps everything in it. Only what the tree has read is searched.
 */
export function filterTree(root: TreeNode, query: string, limit = 1000): Filtered {
  const q = query.trim().toLowerCase()
  let matches = 0
  let capped = false
  const open = new Set<string>()

  const walk = (node: TreeNode): TreeNode | null => {
    if (capped) return null
    if (node.path && node.name.toLowerCase().includes(q)) {
      if (matches >= limit) {
        capped = true
        return null
      }
      matches++
      return node
    }
    if (!node.children) return null
    const kept: TreeNode[] = []
    for (const child of node.children) {
      const hit = walk(child)
      if (hit) kept.push(hit)
    }
    if (!kept.length) return null
    if (node.path) open.add(node.path)
    return { ...node, children: kept }
  }

  const filtered = walk(root) ?? { ...root, children: [] }
  return {
    root: filtered,
    matches,
    capped,
    open: [...open].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)),
  }
}
