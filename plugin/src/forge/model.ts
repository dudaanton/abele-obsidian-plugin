/** Provider-neutral records. IDs are opaque; numbers are scoped by resource kind. */
export type ForgeKind = 'github' | 'forgejo' | 'gitea' | 'gitlab'
export interface Deployment {
  kind: ForgeKind
  webBase: string
  apiBase: string
}
export interface RepoId {
  deployment: Deployment
  fullPath: string
  remoteId?: string
}
export type Support = { supported: true } | { supported: false; reason: string }
export interface ReadResult<T> {
  value: T
  complete: boolean
  next?: string
  notes: string[]
}
export interface Actor {
  id: string
  login: string | null
  name: string | null
  avatarUrl?: string
  webUrl?: string
  deleted: boolean
}
export interface Label {
  id: string
  name: string
  color?: string
}
export interface ThreadPosition {
  path: string
  oldPath?: string
  side: 'before' | 'after'
  line: number | null
  originalLine?: number
  outdated: boolean
  baseCommit?: string
  headCommit?: string
}
export interface Comment {
  id: string
  body: string
  author: Actor | null
  createdAt: string
  updatedAt?: string
  replyTo?: string
  position?: ThreadPosition
  system: boolean
  webUrl?: string
}
export interface Conversation {
  id: string
  number: number
  kind: 'issue' | 'change-request' | 'discussion'
  title: string
  body: string
  state: 'open' | 'closed' | 'merged' | 'unknown'
  author: Actor | null
  labels: Label[]
  commentCount: number | null
  webUrl: string
}
export interface ChangeRequest extends Conversation {
  kind: 'change-request'
  draft: boolean | null
  base: { repository: RepoId; ref: string; commit: string | null }
  head: { repository: RepoId | null; ref: string; commit: string | null }
  additions: number | null
  deletions: number | null
  changedFiles: number | null
}
export interface ChangedFile {
  path: string
  oldPath?: string
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'unknown'
  additions: number | null
  deletions: number | null
  patch?: string
  binary: boolean | null
  complete: boolean
}

/** Stable, non-secret identifier; names and discovered logins may change independently. */
export interface ForgeConnection {
  /** Last explicit access-check verdict; not an authorization grant. */
  checkState?: 'ok' | 'partial' | 'refused' | 'error'
  /** Absent in older settings. Unknown kinds are retained but cannot use the GitHub adapter. */
  provider?: string
  id: string
  name: string
  server: string
  keyId: string
  owners: string[]
  isDefault: boolean
  account?: { login: string; avatarUrl?: string }
  checkedAt?: number
  expiresAt?: string
}
