/** GitHub composition root. Its URL and API quirks stay inside this adapter. */
import type { GithubClient } from '@/github/client'
import { parseGithubUrl, type Endpoints, type GithubTarget } from '@/github/urls'
import type { RepoId } from './model'
import type { ForgeProvider } from './provider'
import { deploymentKey } from './identity'
import { createGithubRepositorySource } from './githubRepository'

export function githubProvider(
  client: GithubClient,
  connectionId = '',
  endpoints: Endpoints = client.endpoints
): ForgeProvider<GithubTarget> {
  const deployment = { kind: 'github' as const, webBase: endpoints.origin, apiBase: endpoints.api }
  const assertRepository = (repo: RepoId) => {
    if (deploymentKey(repo.deployment) !== deploymentKey(deployment))
      throw new Error('The repository belongs to another deployment.')
    if (
      !/^[^/]+\/[^/]+$/.test(repo.fullPath) ||
      repo.fullPath.split('/').some((part) => ['.', '..'].includes(part))
    )
      throw new Error('Invalid GitHub repository path.')
  }
  return {
    deployment,
    session: {
      connectionId,
      generation: client.cacheNamespace,
      assertCurrent: () => client.assertCurrent?.(),
    },
    capabilities: {
      blame: { supported: true },
      discussions: { supported: true },
      serverCodeSearch: { supported: true },
      draftCreate: { supported: true },
      inboxRead: { supported: true },
      inboxDone: { supported: true },
    },
    urls: {
      parse: (address) => {
        try {
          const url = new URL(address)
          if (url.origin !== deployment.webBase || url.username || url.password) return null
          const target = parseGithubUrl(address, [endpoints.webHost])
          if (target && endpoints.webHost !== 'github.com') target.origin = deployment.webBase
          return target
        } catch {
          return null
        }
      },
      repository: (repo) => {
        assertRepository(repo)
        return `${deployment.webBase}/${repo.fullPath.split('/').map(encodeURIComponent).join('/')}`
      },
    },
    repository: (repo) => {
      client.assertCurrent?.()
      assertRepository(repo)
      const [owner, name] = repo.fullPath.split('/')
      return createGithubRepositorySource(
        client,
        {
          host: endpoints.webHost,
          origin: deployment.webBase,
          owner,
          repo: name,
        },
        connectionId
      )
    },
  }
}
