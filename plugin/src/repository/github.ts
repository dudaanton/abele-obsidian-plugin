/** Compatibility entry point for the GitHub repository adapter. */
import type { GithubClient } from '@/github/client'
import type { RepoLike } from '@/github/repoPage/repoHome'
import { createGithubRepositorySource } from '@/forge/githubRepository'
import type { RepositorySource } from './source'

export function githubRepositorySource(
  client: GithubClient,
  repo: RepoLike,
  connection = ''
): RepositorySource {
  // Reactive views must construct their adapter even after access expires. Its reads retain
  // the guarded client and reject inside the async load, which clears content and shows why.
  return createGithubRepositorySource(client, repo, connection)
}
