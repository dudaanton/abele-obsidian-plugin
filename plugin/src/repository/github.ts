/** Compatibility entry point: existing readers now compose the provider adapter. */
import type { GithubClient } from '@/github/client'
import type { RepoLike } from '@/github/repoPage/repoHome'
import { endpoints } from '@/github/urls'
import { githubProvider } from '@/forge/github'
import type { RepositorySource } from './source'

export function githubRepositorySource(
  client: GithubClient,
  repo: RepoLike,
  connection = ''
): RepositorySource {
  const provider = githubProvider(client, connection, {
    ...(client.endpoints ?? endpoints(repo.origin ?? repo.host)),
    webHost: repo.host,
    origin: repo.origin ?? `https://${repo.host}`,
  })
  return provider.repository({
    deployment: provider.deployment,
    fullPath: `${repo.owner}/${repo.repo}`,
  })
}
