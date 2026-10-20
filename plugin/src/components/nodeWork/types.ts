// What the node panel and a copy's tab draw. Plain data, so the screens can be built and tested
// without a node, and the node adapter only has to fill these shapes.

export type NodeStatus = 'connected' | 'connecting' | 'offline'

export interface NodeSummary {
  name: string
  status: NodeStatus
  /** When the node was last heard from, said in words ("5 min ago"); shown while offline. */
  seen?: string
  version?: string
  node_version?: string
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
  /** A question to you is open in it. */
  waiting?: boolean
  /** Its last answer ended with an error. */
  failed?: boolean
  /** It runs with no questions asked. */
  bypass?: boolean
  /** When the work under way began, ms. */
  since?: number
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
  /** Metadata only: neither endpoint can be rendered as a text diff. */
  binary?: boolean
  /** Content omitted by a bounded read; its type may not be known. */
  previewNote?: string
  /** Listed, its contents still being read: the commit page shows the file before its diff. */
  pending?: boolean
}

export interface NodeImagePreview {
  bytes: Uint8Array<ArrayBuffer>
  mime: string
}

export interface FolderEntry {
  name: string
  kind: 'folder' | 'file'
  /** A file's size in words ("2.4 KB"), or how many entries a folder holds. */
  size?: string
}

/** How the side panel lists a copy's files: all of them, the changed ones in their folders, or the changed ones as a list. */
export type FileTreeMode = 'all' | 'changed-tree' | 'changed'
/** What the node panel shows of its place: files, changes, history or pull requests. */
export type NodePanelMode = 'files' | 'changes' | 'history' | 'pulls' | 'sessions'

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
  /** The first parent, which each changed file is compared with. */
  parent?: string
  /** The files the commit changed, for its own page. */
  files?: FileChange[]
  /** How much it changed, when its files are not loaded: files, lines added, lines removed. */
  stats?: { files: number; added: number; removed: number }
  /** Not in the folder's main branch yet. */
  only?: boolean
  /** Came in since this history was last looked at. */
  unseen?: boolean
}

/** A pull request opened from a branch, as the forge reports it. */
export interface PullRequestSummary {
  number: number
  title: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  /** The checks run on its last commit: none run, still running, all passed, or one failed. */
  checks?: 'none' | 'pending' | 'passing' | 'failing'
  /** Reviews: someone asked for changes, or approved. */
  review?: 'approved' | 'changes'
  url?: string
}

/**
 * Where a worktree's branch stands, the way a pull request page says it: the branch it is
 * compared with, how far apart they are, what is not on the remote yet, its pull request, and a
 * rebase or merge that stopped half way.
 */
export interface BranchState {
  hasRemote?: boolean
  /** The branch it is compared with, as people say it; null when none could be found. */
  base: string | null
  /** The same in full (`refs/remotes/origin/main`), for asking the node. */
  baseRef?: string
  /** Commits on this branch and not on the base, and the other way round. */
  ahead: number
  behind: number
  /** The branch on the remote it pushes to; none before the first push. */
  upstream?: string
  /** Commits not pushed yet. */
  unpushed: number
  pr?: PullRequestSummary
  /** A rebase or merge stopped on conflicts, with how many files still conflict. */
  stopped?: { kind: 'rebase' | 'merge'; onto: string; conflicts: number }
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
  /** Short validity readout; the full expiry remains in the tooltip. */
  expiresShort?: string
}
