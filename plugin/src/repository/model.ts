/** Shared repository view data. GitHub readers re-export these names for existing callers. */
import type { DiffFile } from './conversation'
export type NodeKind = 'dir' | 'file' | 'submodule'
import type {
  RepositoryTree,
  RepositoryWorkspace,
  RepositoryStatus,
  RepositoryComparisonMode,
} from './source'
export type { DiffFile } from './conversation'

export interface CommitSummary {
  sha: string
  message: string
  /** The login when the commit is linked to an account, git's author name when not. */
  author: string
  /** Set when `author` is a login. */
  login?: string
  avatar?: string
  date: string
}
export interface RepositoryPerson {
  login: string
  name: string | null
  avatar: string | null
}

export interface CommitData {
  sha: string
  /** The first parent: where a file the commit deletes still exists. */
  parentSha?: string
  message: string
  /** As in `CommitSummary`. */
  author: string
  login?: string
  avatar?: string
  date: string
  url: string
  files: DiffFile[]
}

export interface BlobData {
  /** Immutable commit used for this read, when ref is a human-facing alias. */
  resolvedCommit?: string
  contentId?: string | null
  canLoadLarge?: boolean
  note?: string
  /** Exact endpoint file comparison; absent for the existing original-file view. */
  comparison?: PinnedFile
  ref: string
  path: string
  text: string
  url: string
}

export interface BlameRange {
  start: number
  end: number
  commit: CommitSummary
}

export interface CompareData {
  mode?: RepositoryComparisonMode
  /** The base as compared: for `compare/<head>`, the default branch it was compared with. */
  base: string
  /** The name the base was chosen by, when `base` is the commit it was resolved to. */
  baseName?: string
  head: string
  direct: boolean
  /** `ahead`, `behind`, `diverged` or `identical`. */
  status: string
  /** Null means the source cannot authoritatively count this comparison. */
  aheadBy: number | null
  behindBy: number | null
  totalCommits: number
  /** Oldest first, as GitHub lists them. */
  commits: CommitSummary[]
  /** Not every commit was read: past `MAX_PAGES` pages, or a page was refused. */
  commitsComplete: boolean
  files: DiffFile[]
  /** GitHub sends at most 300 files for a comparison; more than that are on GitHub only. */
  filesComplete: boolean
  additions: number
  deletions: number
  /** Where head split from base: where a file the comparison deletes still exists. */
  mergeBaseSha?: string
  /** The commit head is at: what its files are opened and searched at. */
  headSha?: string
  /** The comparison's address on GitHub. */
  url: string
  /** Why part of it is missing or means something else than the link asked for. */
  note?: string
}

export interface TreeNode {
  name: string
  /** From the repository's root, without a leading slash; empty for the root itself. */
  path: string
  kind: NodeKind
  /** Projection-only label for a removed directory, never repository metadata. */
  comparisonStatus?: string
  mode?: string
  size?: number
  /** The git object: for a folder read lazily, the tree its children are asked by. */
  sha?: string
  /** A folder's entries, folders first; unset while they have not been read. */
  children?: TreeNode[]
}

export interface FolderEntry {
  name: string
  path: string
  kind: NodeKind | 'symlink'
  /** Bytes, for a file. */
  size?: number
}

export interface FolderData {
  resolvedCommit?: string
  ref: string
  /** Empty for the repository's root. */
  path: string
  entries: FolderEntry[]
  /** GitHub's own address for it. */
  url: string
}

export interface RepoMeta {
  /** As GitHub names it now: a renamed repository answers under its new name. */
  owner: string
  name: string
  description: string
  homepage: string
  topics: string[]
  stars: number
  forks: number
  watchers: number
  defaultBranch: string
  /** SPDX id where GitHub knows one (`MIT`), else the licence's name; null without one. */
  license: string | null
  visibility: string
  archived: boolean
  /** The repository this one is a fork of. */
  parent: string | null
  hasIssues: boolean
  url: string
}

export interface RepoHomeData extends FolderData {
  meta: RepoMeta
  /** The repository has no commits: nothing to list, no README. */
  empty?: boolean
  node?: {
    workspaces: RepositoryWorkspace[]
    status: RepositoryStatus
    commits: CommitSummary[]
  }
}

export interface RefList {
  branches: string[]
  tags: string[]
  /** A list came back full: there are more, found by typing their start. */
  more: boolean
}

export interface FileCounts {
  state: 'pending' | 'ready' | 'unavailable'
  additions?: number
  deletions?: number
}

export interface ComparisonIndex {
  baseSha: string
  targetSha: string
  base: RepositoryTree
  target: RepositoryTree
  changes: FileChange[]
  counts: Map<string, FileCounts>
}

export interface PinnedFile {
  baseSha: string
  targetSha: string
  path: string
  index: ComparisonIndex
  change: FileChange
  before?: BlobContent
  after?: BlobContent
  text?: TextDiff
  note?: string
  canLoadLarge?: boolean
}

export interface ResultLine {
  /** What the line is called beside the text: its number, and "before" for a removed one. */
  label: string
  text: string
  column: number
  length: number
  url: string
}

export interface ResultFile {
  path: string
  url: string
  lines: ResultLine[]
}

export interface CodeResults {
  /** The next page includes the results already shown. */
  next?: () => Promise<CodeResults>
  files: ResultFile[]
  /** Matching lines, or files for a name search. */
  total: number
  capped: boolean
  /** Said above the results: where they came from, when it is not the obvious place. */
  note?: string
}

export interface RepositoryLink {
  label: string
  url: string
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

export interface TextDiff {
  lines: DiffLine[]
  additions: number
  deletions: number
}

export type BlobContent =
  | { kind: 'text' | 'lfs'; text: string }
  | { kind: 'binary' | 'unsupported'; text?: undefined }

export type DiffLineType = 'hunk' | 'add' | 'del' | 'ctx' | 'note'

export interface DiffLine {
  type: DiffLineType
  /** The line without its leading `+`, `-` or space. A hunk header is kept whole. */
  text: string
  old?: number
  new?: number
}
