// What the node panel and a copy's tab draw. Plain data, so the screens can be built and tested
// without a node, and the node adapter only has to fill these shapes.

export type NodeStatus = 'connected' | 'connecting' | 'offline'

export interface NodeSummary {
  name: string
  status: NodeStatus
  /** When the node was last heard from, said in words ("5 min ago"); shown while offline. */
  seen?: string
  version?: string
  /** Where the node is reached, for a remote one. */
  address?: string
}

/** A working copy of a folder: the folder itself, one of its worktrees, or a detached checkout. */
export interface CopySummary {
  id: string
  kind: 'project' | 'worktree' | 'detached'
  /** The branch, or the short commit for a detached copy. */
  branch: string
  path: string
  /** Files with uncommitted changes. */
  changed: number
  missing?: boolean
}

export interface FolderSummary {
  id: string
  name: string
  path: string
  /** A git repository; a plain folder has no copies and no git state. */
  git: boolean
  missing?: boolean
  copies: CopySummary[]
}

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict'

export interface FileChange {
  path: string
  kind: ChangeKind
  /** Some of the change is staged and some is not. */
  partlyStaged?: boolean
  /** The old path of a renamed file. */
  from?: string
  added: number
  removed: number
  before: string
  after: string
}

export interface FolderEntry {
  name: string
  kind: 'folder' | 'file'
  /** A file's size in words ("2.4 KB"), or how many entries a folder holds. */
  size?: string
}

export interface CommitSummary {
  hash: string
  subject: string
  author: string
  /** Time of day or relative time, as it should read. */
  when: string
  /** The day heading the commit is grouped under ("Today", "Yesterday", "8 October"). */
  day: string
}

/** One folder on the node as the Open folder dialog lists it. */
export interface NodeDirectory {
  name: string
  path: string
  git?: { branch: string; copies: number }
  open?: boolean
}
