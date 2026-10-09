import type {
  BlobData,
  CommitData,
  CommitSummary,
  BlameRange,
  CompareData,
  ComparisonIndex,
  PinnedFile,
  TreeNode,
  FolderData,
  RepoHomeData,
  RefList,
  CodeResults,
  RepositoryLink,
} from './model'
/** Repository reads bind to one source and authority generation. */
import type { GithubTarget } from '@/github/urls'
import type { ItemData, PinnedLoad } from '@/github/loadItem'
import type { LanguageShare, ItemRow, ReleaseData } from '@/github/repoPage/repoHome'
import type { Scope, TabChanges } from '@/github/search/tabCode'
import type { CodeQuery } from '@/github/search/textSearch'
import type { Stage } from '@/github/search/source'
import type { DefinitionHit } from '@/github/search/definitions'
import type { LineSpan } from '@/github/permalinks'

export type RepositoryIdentity =
  | { provider: 'github'; connection: string; server: string; repository: string }
  | { provider: 'node'; installation: string; node: string; project: string; workspace: string }
export type RepositoryRevision =
  | { kind: 'commit'; commit: string }
  | { kind: 'working-tree'; head: string | null; observation: string; observedAt: string }
export type RepositoryComparisonMode = 'endpoint' | 'merge-base' | 'staged' | 'unstaged'
export type RepositoryLocation =
  | { kind: 'home'; ref?: string }
  | { kind: 'file' | 'folder'; ref: string; path: string; lines?: LineSpan; contentId?: string }
  | { kind: 'commit'; commit: string }
  | { kind: 'comparison'; base?: string; head: string; direct?: boolean; mode?: RepositoryComparisonMode }
export interface RepositoryTarget {
  source: RepositoryIdentity
  revision?: RepositoryRevision
  location: RepositoryLocation
}
export interface RepositoryTree {
  readonly root: TreeNode
  readonly sha: string
  readonly truncated: boolean
  expand(node: TreeNode): Promise<void>
  reveal(path: string): Promise<void>
}
export interface RepositoryWorkspace {
  id: string
  label: string
  revision?: RepositoryRevision
  readOnly: boolean
  kind?: 'root' | 'managed' | 'external'
  branch?: string | null
  head?: string | null
  dirty?: boolean | null
  availability?: 'available' | 'missing' | 'unavailable' | 'bare'
  workspaceId?: string | null
  locked?: boolean
  prunable?: boolean
}
export interface RepositoryStatus {
  supported: boolean
  revision?: RepositoryRevision
  files: { path: string; staged: boolean; unstaged: boolean; untracked: boolean; status?: string }[]
}
export interface RepositoryChange {
  kind: 'authority' | 'workspace' | 'refs' | 'tree' | 'status'
  paths?: string[]
}
export interface RepositorySearch {
  ref: string
  scope: Scope
  query: CodeQuery
  glob: string
  limitBytes: number
  changes?: TabChanges | null
  onStage?: (stage: Stage) => void
  signal?: AbortSignal
}
export interface RepositoryNavigation {
  workspace?(id: string): string
  home(ref?: string, defaultBranch?: string): string
  file(ref: string, path: string, line?: number): string
  folder(ref: string, path: string): string
  commit(commit: string): string
  comparison(base: string, head: string, direct?: boolean, mode?: RepositoryComparisonMode): string
  blobLink(commit: string, path: string, lines: LineSpan): RepositoryLink
}
export interface GithubRepositoryCapabilities {
  loadTarget(
    target: GithubTarget,
    promote: (target: GithubTarget) => void,
    pinned?: PinnedLoad
  ): Promise<ItemData>
  listUrl(kind: 'issues' | 'pulls' | 'releases'): string
  languages(): Promise<LanguageShare[]>
  issues(): Promise<ItemRow[]>
  pulls(): Promise<ItemRow[]>
  release(): Promise<ReleaseData | null>
}
export interface RepositorySource {
  readonly identity: RepositoryIdentity
  readonly cacheNamespace: string
  readonly isCurrent: boolean
  readonly navigation: RepositoryNavigation
  readonly github?: GithubRepositoryCapabilities
  assertCurrent(): void
  /** Deliberate refresh drops mutable aliases, never retained revisions or comparisons. */
  refresh?(): void
  revision?(ref: string): RepositoryRevision | undefined
  metadata(): Promise<RepoHomeData['meta']>
  home(ref?: string): Promise<RepoHomeData>
  workspaces(): Promise<RepositoryWorkspace[]>
  refs(prefix?: string): Promise<RefList>
  defaultBranch(): Promise<string>
  resolve(ref?: string, verify?: boolean): Promise<string>
  tree(commit: string): Promise<RepositoryTree>
  folder(ref: string, path: string): Promise<FolderData>
  blob(ref: string, path: string, contentId?: string): Promise<BlobData>
  largeBlob?(ref: string, path: string, contentId?: string): Promise<BlobData>
  text(ref: string, path: string, what?: string): Promise<string>
  status(): Promise<RepositoryStatus>
  compare(base: string | undefined, head: string, direct?: boolean, mode?: RepositoryComparisonMode): Promise<CompareData>
  comparison(base: string, head: string, signal?: AbortSignal): Promise<ComparisonIndex>
  comparisonFile(
    index: ComparisonIndex,
    path: string,
    large?: boolean,
    signal?: AbortSignal
  ): Promise<PinnedFile>
  commit(commit: string): Promise<CommitData>
  commits(ref: string, path?: string): Promise<CommitSummary[]>
  blame(ref: string, path: string): Promise<BlameRange[]>
  search(request: RepositorySearch): Promise<CodeResults>
  definitions(
    ref: string,
    name: string,
    fromPath: string,
    limitBytes: number,
    onStage?: (stage: Stage) => void
  ): Promise<DefinitionHit[]>
  subscribe(listener: (change: RepositoryChange) => void): () => void
}
export const sourceKey = (identity: RepositoryIdentity): string =>
  identity.provider === 'github'
    ? JSON.stringify([
        'github',
        identity.connection,
        identity.server,
        identity.repository.toLowerCase(),
      ])
    : JSON.stringify([
        'node',
        identity.installation,
        identity.node,
        identity.project,
        identity.workspace,
      ])
