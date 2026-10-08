import { buildTree, findNode, sortNodes, type TreeNode } from '../tree/fileTree'

/** Only this repository-reader interface is needed by endpoint comparison logic. */
export interface TreeReader {
  root: TreeNode
  expand(node: TreeNode): Promise<void>
}
export interface FileChange {
  path: string
  previousPath?: string
  status:
    | 'added'
    | 'removed'
    | 'modified'
    | 'renamed'
    | 'mode changed'
    | 'type changed'
    | 'unchanged'
  base?: TreeNode
  target?: TreeNode
}
const equal = (a: TreeNode, b: TreeNode) =>
  !!a.sha && a.sha === b.sha && a.mode === b.mode && a.kind === b.kind

/** No merge-base and no 300-file compare limit. Identical subtrees need no traversal. */
export async function compareTrees(
  base: TreeReader,
  target: TreeReader,
  signal?: AbortSignal
): Promise<FileChange[]> {
  const rows: FileChange[] = []
  const check = () => {
    if (signal?.aborted) throw new DOMException('Comparison cancelled', 'AbortError')
  }
  const walk = async (a?: TreeNode, b?: TreeNode): Promise<void> => {
    check()
    if (a && b && equal(a, b)) return
    if (a?.kind === 'dir' || b?.kind === 'dir') {
      if (a && a.kind !== 'dir') rows.push({ path: a.path, status: 'removed', base: a })
      if (b && b.kind !== 'dir') rows.push({ path: b.path, status: 'added', target: b })
      const ad = a?.kind === 'dir' ? a : undefined,
        bd = b?.kind === 'dir' ? b : undefined
      // Sequential depth-first traversal bounds outstanding tree requests independently of size.
      if (ad && !ad.children) await base.expand(ad)
      if (bd && !bd.children) await target.expand(bd)
      check()
      const left = new Map((ad?.children ?? []).map((n) => [n.name, n]))
      const right = new Map((bd?.children ?? []).map((n) => [n.name, n]))
      for (const name of new Set([...left.keys(), ...right.keys()]))
        await walk(left.get(name), right.get(name))
      return
    }
    const path = b?.path ?? a!.path
    const status = !a
      ? 'added'
      : !b
        ? 'removed'
        : a.kind !== b.kind
          ? 'type changed'
          : a.sha === b.sha
            ? 'mode changed'
            : 'modified'
    rows.push({ path, status, base: a, target: b })
  }
  await walk(base.root, target.root)
  return pairRenames(rows)
}

/** Conservative fallback: only unique identical blobs with matching modes are paired. */
export function pairRenames(rows: FileChange[]): FileChange[] {
  const identity = (n: TreeNode) => `${n.kind}:${n.mode ?? ''}:${n.sha}`
  const adds = new Map<string, FileChange[]>(),
    deletes = new Map<string, FileChange[]>()
  for (const row of rows) {
    const node =
      row.status === 'added' ? row.target : row.status === 'removed' ? row.base : undefined
    if (!node?.sha || node.kind !== 'file') continue
    const groups = row.status === 'added' ? adds : deletes,
      key = identity(node)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const paired = new Set<FileChange>()
  for (const [key, added] of adds) {
    const removed = deletes.get(key)
    if (added.length !== 1 || removed?.length !== 1) continue
    added[0].base = removed[0].base
    added[0].previousPath = removed[0].path
    added[0].status = 'renamed'
    paired.add(removed[0])
  }
  return rows.filter((row) => !paired.has(row)).sort((a, b) => a.path.localeCompare(b.path))
}

/** A view projection, never a mutation of the credential-scoped target tree. */
export function projectTree(
  target: TreeNode,
  changes: FileChange[],
  changedOnly: boolean
): TreeNode {
  const from = (rows: FileChange[]) =>
    buildTree(
      rows.map((row) => {
        const n = row.target ?? row.base!
        return {
          path: row.path,
          type: n.kind === 'submodule' ? 'commit' : 'blob',
          mode: n.mode,
          sha: n.sha,
          size: n.size,
        }
      })
    )
  const extras = from(changes.filter((row) => !row.target))
  const markRemovedFolders = (node: TreeNode) => {
    if (node.kind === 'dir' && node.path && findNode(target, node.path)?.kind !== 'dir')
      node.comparisonStatus = 'removed folder'
    for (const child of node.children ?? []) markRemovedFolders(child)
  }
  markRemovedFolders(extras)
  const root = changedOnly ? from(changes.filter((row) => !!row.target)) : target
  const merge = (a: TreeNode, b?: TreeNode): TreeNode => {
    if (!b?.children) return a
    const key = (node: TreeNode) => `${node.kind}:${node.name}`
    const children = new Map((a.children ?? []).map((n) => [key(n), n]))
    for (const node of b.children) {
      const existing = children.get(key(node))
      children.set(key(node), existing?.kind === 'dir' ? merge(existing, node) : (existing ?? node))
    }
    return { ...a, children: sortNodes([...children.values()]) }
  }
  return merge(root, extras)
}
