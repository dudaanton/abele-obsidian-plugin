import type { PullRequestSummary } from '@/components/nodeWork/types'
import { githubClient, githubSettings } from '@/github/GithubService'
import { isGithubConnection, connectionUnavailableReason } from '@/github/connections'
import { GithubError } from '@/github/client'
import { pullSummary, type RawPull } from './nodePathGit'
import type { NewPull } from './NodePathModel'

/** A repository on a git service, as the node names a remote's. */
export interface ForgeRepo {
  kind: 'github' | 'gitlab' | 'other'
  host: string
  owner: string
  name: string
}
/** The git service a node folder's remote lives on: its open pull requests, and opening one. */
export interface PathForge {
  pulls(
    repo: ForgeRepo
  ): Promise<{ connected: boolean; pulls: (PullRequestSummary & { branch: string })[] }>
  create(repo: ForgeRepo, pull: NewPull & { head: string }): Promise<{ number: number; url?: string }>
}

const path = (repo: ForgeRepo) =>
  `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
const refused = (error: unknown) =>
  error instanceof GithubError && ['auth', 'sso', 'forbidden', 'not-found'].includes(error.kind)

/** Older node metadata names a host, without selecting an installed provider adapter. */
function unavailableProvider(repo: ForgeRepo): string {
  const rows = (githubSettings().connections ?? []).filter((connection) => {
    try {
      const server = connection.server || 'https://github.com'
      return (
        new URL(/^https?:\/\//i.test(server) ? server : `https://${server}`).host.toLowerCase() ===
        repo.host.toLowerCase()
      )
    } catch {
      return false
    }
  })
  return rows.some(isGithubConnection)
    ? ''
    : (rows.map(connectionUnavailableReason).find(Boolean) ?? '')
}

/** GitHub, through the plugin's own GitHub connection; other services are not read yet. */
export const githubForge: PathForge = {
  async pulls(repo) {
    if (repo.kind !== 'github' || unavailableProvider(repo)) return { connected: false, pulls: [] }
    try {
      const { items } = await githubClient(repo.host).list<RawPull>(
        `${path(repo)}/pulls?state=open`,
        { what: 'the pull requests' }
      )
      return { connected: true, pulls: items.map(pullSummary) }
    } catch (error) {
      // No token for it, or one that cannot see it: the way through is connecting the service.
      if (refused(error)) return { connected: false, pulls: [] }
      throw error
    }
  },
  async create(repo, pull) {
    if (repo.kind !== 'github') throw new Error('Pull requests can be opened on GitHub only.')
    const unavailable = unavailableProvider(repo)
    if (unavailable) throw new Error(unavailable)
    const answer = await githubClient(repo.host).call<RawPull>('POST', `${path(repo)}/pulls`, {
      what: 'the new pull request',
      body: {
        title: pull.title,
        body: pull.body,
        head: pull.head,
        base: pull.base,
        draft: pull.draft,
      },
    })
    if (answer.error || !answer.body) throw answer.error ?? new Error('GitHub did not answer.')
    return {
      number: answer.body.number,
      ...(answer.body.html_url ? { url: answer.body.html_url } : {}),
    }
  },
}
