import { UiError, uiMessage } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import type { PullRequestSummary } from '@/components/nodeWork/types'
import { githubClient, githubSettings } from '@/github/GithubService'
import { isGithubConnection, connectionUnavailableReason } from '@/github/connections'
import { GithubError } from '@/github/client'
import { pullSummary, type RawPull } from './nodePathGit'
import type { NewPull } from './NodePathModel'
import { isNativeForge, nativeLabel } from '@/forge/native'
import { deployment } from '@/forge/identity'
import { forgejoConnectionClient } from '@/forge/forgejoConnections'
import { nativeWrites } from '@/forge/forgejoWrites'

/** A repository on a git service, as the node names a remote's. */
export interface ForgeRepo {
  kind: 'github' | 'gitlab' | 'other'
  host: string
  owner: string
  name: string
  /** Newer nodes may preserve the full remote deployment rather than only its host. */
  deployment?: string
}
/** The git service a node folder's remote lives on: its open pull requests, and opening one. */
export interface PathForge {
  cacheKey?(repo: ForgeRepo): string
  pulls(repo: ForgeRepo): Promise<{
    connected: boolean
    draftSupported?: boolean
    serviceLabel?: string
    pulls: (PullRequestSummary & { branch: string })[]
  }>
  create(
    repo: ForgeRepo,
    pull: NewPull & { head: string }
  ): Promise<{ number: number; url?: string }>
}

const path = (repo: ForgeRepo) =>
  `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
const refused = (error: unknown) =>
  error instanceof GithubError && ['auth', 'sso', 'forbidden', 'not-found'].includes(error.kind)

function nativeConnection(repo: ForgeRepo) {
  if (
    repo.kind === 'github' &&
    (githubSettings().connections ?? []).some((c) => {
      if (!isGithubConnection(c)) return false
      try {
        const url = new URL(
          /^https?:\/\//i.test(c.server) ? c.server : `https://${c.server || 'github.com'}`
        )
        return (
          url.host.toLowerCase() === repo.host.toLowerCase() &&
          (!repo.deployment || url.origin === repo.deployment)
        )
      } catch {
        return false
      }
    })
  )
    return undefined
  const candidates = (githubSettings().connections ?? []).filter((c) => {
    if (!isNativeForge(c.provider)) return false
    const base = deployment(c.provider, c.server)
    if (
      !repo.deployment &&
      new URL(base.webBase).hostname.toLowerCase() === repo.host.toLowerCase() &&
      new URL(base.webBase).host.toLowerCase() !== repo.host.toLowerCase()
    )
      throw new Error(
        'The node omits the service port. A full deployment URL is required for this connection.'
      )
    return new URL(base.webBase).host.toLowerCase() === repo.host.toLowerCase()
  })
  if (!candidates.length) return undefined
  const baseOf = (c: (typeof candidates)[number]) =>
    deployment(c.provider === 'gitea' ? 'gitea' : 'forgejo', c.server).webBase
  const bases = new Set(candidates.map(baseOf))
  if (repo.deployment) {
    for (const c of [...candidates])
      if (baseOf(c) !== repo.deployment) candidates.splice(candidates.indexOf(c), 1)
  } else if (bases.size !== 1 || new URL([...bases][0]).pathname !== '/') {
    throw new Error(
      'The node reports only a host. A full deployment URL is required for this connection; open this repository from the service picker.'
    )
  }
  const preferred = candidates.filter((c) => c.isDefault)
  if (candidates.length > 1 && preferred.length !== 1)
    throw new Error('Choose a default account for this service before creating a pull request.')
  return preferred[0] ?? candidates[0]
}

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
  cacheKey(repo) {
    const native = nativeConnection(repo)
    return native
      ? `${native.provider}:${native.server}:${native.id}:${forgejoConnectionClient(native.id).session.generation}`
      : `${repo.kind}:${repo.host}`
  },
  async pulls(repo) {
    const native = nativeConnection(repo)
    if (native) {
      const client = forgejoConnectionClient(native.id)
      const result = await client.pages<RawPull>(`${path(repo)}/pulls?state=open`, 50, 20)
      if (!result.complete)
        throw new Error('The pull request list is incomplete. Open the service to see the rest.')
      return {
        connected: true,
        draftSupported: false,
        serviceLabel: nativeLabel(native.provider),
        pulls: result.value.map(pullSummary),
      }
    }
    if (repo.kind !== 'github' || unavailableProvider(repo)) return { connected: false, pulls: [] }
    try {
      const { items } = await githubClient(repo.host).list<RawPull>(
        `${path(repo)}/pulls?state=open`,
        { what: t('streamB.thePullRequests.d2ab03') }
      )
      return { connected: true, pulls: items.map(pullSummary) }
    } catch (error) {
      // No token for it, or one that cannot see it: the way through is connecting the service.
      if (refused(error)) return { connected: false, pulls: [] }
      throw error
    }
  },
  async create(repo, pull) {
    const native = nativeConnection(repo)
    if (native)
      return nativeWrites(forgejoConnectionClient(native.id), `${repo.owner}/${repo.name}`).create(
        pull
      )
    if (repo.kind !== 'github')
      throw new UiError(uiMessage('streamB.pullRequestsCanBeOpenedOnGithub.86a00a'))
    const unavailable = unavailableProvider(repo)
    if (unavailable) throw new Error(unavailable)
    const answer = await githubClient(repo.host).call<RawPull>('POST', `${path(repo)}/pulls`, {
      what: t('streamB.theNewPullRequest.56f7c6'),
      body: {
        title: pull.title,
        body: pull.body,
        head: pull.head,
        base: pull.base,
        draft: pull.draft,
      },
    })
    if (answer.error || !answer.body)
      throw answer.error ?? new UiError(uiMessage('streamB.githubDidNotAnswer.c568a3'))
    return {
      number: answer.body.number,
      ...(answer.body.html_url ? { url: answer.body.html_url } : {}),
    }
  },
}
