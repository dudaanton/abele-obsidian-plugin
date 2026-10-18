import type { FolderSummary } from '@/components/nodeWork/types'
import type { PathTarget } from './NodePathModel'

/** Catalogue metadata used only to recover the panel selection, never chat authority. */
export interface TargetLocation {
  root: string
  path: string
  kind: 'root' | 'managed' | 'external' | 'folder'
}

function location(target: PathTarget, folders: FolderSummary[]): TargetLocation | undefined {
  const matches = folders.filter((folder) => folder.id === target.projectId)
  if (matches.length !== 1) return
  const folder = matches[0]
  if (folder.missing || !folder.path.startsWith('/')) return
  if (target.kind === 'workspace') {
    if (folder.git) return
    return { root: folder.path, path: folder.path, kind: 'folder' }
  }
  if (!folder.git) return
  const copies = folder.copies.filter((copy) => copy.id === target.id)
  if (copies.length !== 1 || copies[0].missing) return
  const copy = copies[0]
  if (target.location) {
    if (target.location.root !== folder.path || !target.location.path.startsWith('/')) return
    if ((copy.kind === 'project') !== (target.location.kind === 'root')) return
    if (target.location.kind === 'root' && target.location.path !== folder.path) return
    return target.location
  }
  // Older snapshots retain the registered root and its role, but other copies may
  // have only a display basename. A basename cannot identify a filesystem target.
  if (copy.kind === 'project') return { root: folder.path, path: folder.path, kind: 'root' }
}

export function replacementTarget(
  previous: PathTarget,
  previousFolders: FolderSummary[],
  targets: PathTarget[],
  folders: FolderSummary[]
): PathTarget | undefined {
  if (previous.incarnation) return
  const before = location(previous, previousFolders)
  if (!before) return
  const matches = targets.filter((target) => {
    if (
      target.incarnation ||
      target.nodeId !== previous.nodeId ||
      target.registrationId !== previous.registrationId ||
      target.projectId !== previous.projectId ||
      target.kind !== previous.kind
    )
      return false
    const after = location(target, folders)
    return (
      after &&
      before.root === after.root &&
      before.path === after.path &&
      before.kind === after.kind
    )
  })
  return matches.length === 1 ? matches[0] : undefined
}
