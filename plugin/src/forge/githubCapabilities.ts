/** Compatibility capability for existing GitHub screens, retained until their neutral adapters land. */
import type { GithubTarget } from '@/github/urls'
import type { ItemData, PinnedLoad } from '@/github/loadItem'
import type { LanguageShare, ItemRow, ReleaseData } from '@/github/repoPage/repoHome'
import type { FilesData, Conversation } from '@/repository/conversation'
import type { CommitSummary } from '@/repository/model'

export interface GithubRepositoryCapabilities {
  writes?: ReturnType<typeof import('./forgejoWrites').nativeWrites>
  person?(login: string): Promise<import('@/repository/model').RepositoryPerson>
  listMore?(
    target: Extract<GithubTarget, { kind: 'list' }>,
    page: number | string
  ): Promise<import('@/github/lists/listData').ListPage>
  listChoices?(): Promise<import('@/github/lists/listData').ListChoices>
  pullFiles?(number: number): Promise<FilesData>
  pullCommits?(number: number): Promise<{ commits: CommitSummary[]; complete: boolean }>
  conversation?(number: number, pull: boolean): Promise<Conversation>
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
