/** Compatibility capability for existing GitHub screens, retained until their neutral adapters land. */
import type { GithubTarget } from '@/github/urls'
import type { ItemData, PinnedLoad } from '@/github/loadItem'
import type { LanguageShare, ItemRow, ReleaseData } from '@/github/repoPage/repoHome'

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
