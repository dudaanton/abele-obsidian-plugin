import type { RepositoryTreeChange } from '@abele/node-protocol'
import { findNode, sortNodes, type TreeNode } from '@/github/tree/fileTree'

type NodeEntry = Extract<RepositoryTreeChange, { entry: unknown }>['entry']

/** A node repository entry as the file tree's own row, the way a folder read builds it. */
export function nodeTreeNode(entry: NodeEntry): TreeNode {
  return {
    name: entry.name,
    path: entry.path,
    kind: entry.kind === 'directory' ? 'dir' : entry.kind === 'submodule' ? 'submodule' : 'file',
    mode: entry.kind === 'symlink' ? '120000' : entry.kind === 'directory' ? '040000' : '100644',
    ...(entry.oid ? { sha: entry.oid } : {}),
    ...(entry.size !== null ? { size: entry.size } : {}),
  }
}

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** The row's own fields from a newer entry, keeping the object and a folder's read children. */
function update(node: TreeNode, entry: NodeEntry) {
  const next = nodeTreeNode(entry)
  if (node.kind !== next.kind) delete node.children
  node.kind = next.kind
  node.mode = next.mode
  if (next.sha === undefined) delete node.sha
  else node.sha = next.sha
  if (next.size === undefined) delete node.size
  else node.size = next.size
}

function detach(root: TreeNode, path: string): TreeNode | null {
  const parent = findNode(root, parentOf(path))
  const index = parent?.children?.findIndex((child) => child.path === path) ?? -1
  if (!parent?.children || index < 0) return null
  return parent.children.splice(index, 1)[0] ?? null
}

function attach(root: TreeNode, node: TreeNode) {
  const parent = findNode(root, parentOf(node.path))
  // A folder never read lists the row when it is opened; nothing to keep in step until then.
  if (!parent?.children) return
  parent.children.push(node)
  sortNodes(parent.children)
}

function moveTo(node: TreeNode, path: string) {
  const from = node.path
  node.path = path
  node.name = path.slice(path.lastIndexOf('/') + 1)
  for (const child of node.children ?? []) moveTo(child, path + child.path.slice(from.length))
}

/**
 * Applies one `repository.changed` batch to a lazily read tree in place: rows that did not
 * change keep their very objects, so open folders stay open and nothing redraws but the rows
 * that changed. Entries describe the resulting state, so applying one the tree already shows
 * (after a reread that overlapped the batch) changes nothing. Returns the changed paths.
 */
export function applyTreeChanges(root: TreeNode, entries: readonly RepositoryTreeChange[]) {
  const changed: string[] = []
  for (const change of entries) {
    if (change.change === 'deleted') {
      detach(root, change.path)
      changed.push(change.path)
      continue
    }
    const { entry } = change
    let node: TreeNode | null = null
    if (change.change === 'renamed') {
      changed.push(change.from)
      node = detach(root, change.from)
      if (node) moveTo(node, entry.path)
    }
    const existing = findNode(root, entry.path)
    if (existing && existing !== root) {
      update(existing, entry)
    } else if (node) {
      update(node, entry)
      attach(root, node)
    } else attach(root, nodeTreeNode(entry))
    changed.push(entry.path)
  }
  return changed
}
