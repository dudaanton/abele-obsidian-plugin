import type { RepositoryTreeChange } from '@abele/node-protocol'
import type { TreeEntry } from '@/components/nodeWork/types'

/** One in-order batch of the node's change stream, as the path sidebar applies it. */
export interface PathTreeBatch {
  entries: readonly RepositoryTreeChange[]
  /** Git state moved: the change list is read again, not the tree. */
  git: boolean
}

type NodeEntry = Extract<RepositoryTreeChange, { entry: unknown }>['entry']

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** The sidebar lists files and folders only, as its folder reads do. */
function rowOf(entry: NodeEntry): TreeEntry | null {
  if (entry.kind === 'file') return { path: entry.path, name: entry.name, kind: 'file' }
  if (entry.kind === 'directory') return { path: entry.path, name: entry.name, kind: 'folder' }
  return null
}

function moved(entry: TreeEntry, path: string): TreeEntry {
  return {
    ...entry,
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    ...(entry.children
      ? { children: entry.children.map((c) => moved(c, path + c.path.slice(entry.path.length))) }
      : {}),
  }
}

/**
 * Rewrites the listing of `folder` with `edit`, copying only the folders on the way to it, so
 * every other row keeps its very object. A folder never read is left alone: it is read as it
 * is when it is opened.
 */
function within(
  entries: TreeEntry[],
  folder: string,
  edit: (children: TreeEntry[]) => TreeEntry[]
): TreeEntry[] {
  if (!folder) return edit(entries)
  const index = entries.findIndex((e) => e.path === folder || folder.startsWith(e.path + '/'))
  const holder = entries[index]
  if (!holder?.children) return entries
  const children =
    holder.path === folder ? edit(holder.children) : within(holder.children, folder, edit)
  if (children === holder.children) return entries
  const next = entries.slice()
  next[index] = { ...holder, children }
  return next
}

function find(entries: TreeEntry[], path: string): TreeEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry
    if (entry.children && path.startsWith(entry.path + '/')) return find(entry.children, path)
  }
}

function remove(entries: TreeEntry[], path: string) {
  return within(entries, parentOf(path), (children) =>
    children.some((c) => c.path === path) ? children.filter((c) => c.path !== path) : children
  )
}

/**
 * How the node orders a folder's listing: a git copy by `localeCompare`, a plain folder by the
 * names' code units.
 */
export type PathOrder = 'git' | 'plain'
const after = (order: PathOrder, a: string, b: string) =>
  order === 'git' ? a.localeCompare(b) > 0 : a > b

/** Places a row where the node lists it, replacing one of the same path. */
function put(entries: TreeEntry[], row: TreeEntry, order: PathOrder) {
  return within(entries, parentOf(row.path), (children) => {
    const next = children.filter((c) => c.path !== row.path)
    const at = next.findIndex((c) => after(order, c.path, row.path))
    next.splice(at < 0 ? next.length : at, 0, row)
    return next
  })
}

/**
 * Applies one batch to the sidebar's lazily read listing. Rows the batch does not name keep
 * their objects and a folder that was opened keeps what was read in it. Entries describe the
 * resulting state, so a batch the listing already shows changes nothing.
 */
export function applyPathChanges(
  entries: TreeEntry[],
  changes: readonly RepositoryTreeChange[],
  order: PathOrder = 'git'
): TreeEntry[] {
  for (const change of changes) {
    if (change.change === 'deleted') {
      entries = remove(entries, change.path)
      continue
    }
    const row = rowOf(change.entry)
    let carried: TreeEntry | undefined
    if (change.change === 'renamed') {
      const from = find(entries, change.from)
      entries = remove(entries, change.from)
      if (from && row && from.kind === row.kind) carried = moved(from, row.path)
    }
    if (!row) {
      entries = remove(entries, change.entry.path)
      continue
    }
    const existing = find(entries, row.path)
    if (existing?.kind === row.kind && existing.name === row.name && !carried) continue
    entries = put(entries, carried ?? row, order)
  }
  return entries
}
