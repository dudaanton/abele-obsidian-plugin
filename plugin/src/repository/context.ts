import { computed, inject, type ComputedRef, type InjectionKey } from 'vue'
import type { GithubClient } from '@/github/client'
import type { RepoLike } from '@/github/repoPage/repoHome'
import type { RepositorySource } from './source'
import { githubRepositorySource } from './github'

export const REPOSITORY_SOURCE: InjectionKey<ComputedRef<RepositorySource | null>> =
  Symbol('repository-source')
/** Standalone GitHub previews retain client props; repository tabs inject their source. */
export function useRepositorySource(
  client?: () => GithubClient | undefined,
  repo?: () => RepoLike
) {
  const provided = inject(REPOSITORY_SOURCE, null)
  return computed(() => {
    if (provided?.value) return provided.value
    const current = client?.()
    return current && repo ? githubRepositorySource(current, repo()) : null
  })
}
