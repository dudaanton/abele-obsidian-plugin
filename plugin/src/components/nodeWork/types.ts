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
  /** Changed files you have not looked at since they changed. */
  unseen?: number
  /** An agent is working in this copy right now. */
  running?: boolean
  /** Commits ahead of and behind the folder's main branch. */
  ahead?: number
  behind?: number
  /** The last commit, said as it should read ("Fix navigation · 2 h ago"). */
  lastCommit?: string
  /** The node agent's chats that work in this copy. */
  chats?: ChatSummary[]
}

/** A chat of the node agent, listed under the copy it works in. */
export interface ChatSummary {
  id: string
  title: string
  /** The agent is answering now. */
  running?: boolean
  /** Something new since you last opened it. */
  unseen?: boolean
  when: string
}

export interface FolderSummary {
  id: string
  name: string
  path: string
  /** A git repository; a plain folder has no copies and no git state. */
  git: boolean
  missing?: boolean
  /** Chats bound to the root workspace of a plain folder. */
  chats?: ChatSummary[]
  copies: CopySummary[]
}

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict'

export interface FileChange {
  path: string
  kind: ChangeKind
  /** Where the change sits: in the working tree, prepared for the commit, or partly both. */
  stage?: 'unstaged' | 'staged' | 'partly'
  /** Some of the change is staged and some is not. */
  partlyStaged?: boolean
  /** When the file last changed, said as it should read ("5 min ago"). */
  when?: string
  /** Changed since you last looked at it. */
  unseen?: boolean
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

/** One file or folder of a copy's tree; a file carries its git change, if it has one. */
export interface TreeEntry {
  path: string
  name: string
  kind: 'folder' | 'file'
  children?: TreeEntry[]
  change?: FileChange
}

export interface CommitSummary {
  hash: string
  subject: string
  author: string
  /** Time of day or relative time, as it should read. */
  when: string
  /** The day heading the commit is grouped under ("Today", "Yesterday", "8 October"). */
  day: string
  /** The files the commit changed, for its own page. */
  files?: FileChange[]
}

/** One folder on the node as the Open folder dialog lists it. */
export interface NodeDirectory {
  name: string
  path: string
  git?: { branch: string; copies: number }
  open?: boolean
  /** False until opening/registration establishes whether this directory is a Git root. */
  inspected?: boolean
}

/** What a pairing code from `abele-node pair` holds, read out of it. */
export interface PairingCode {
  name: string
  nodeId?: string
  host: string
  port: number
  fingerprint: string
  /** How long the code stays good, in words ("10 more minutes"). */
  expires: string
}
