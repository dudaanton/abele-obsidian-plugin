/**
 * "Check access": what this device's token can read, asked of GitHub one permission at a time.
 *
 * `/user` answers for any valid token and says nothing about a repository, so a token that is
 * refused on the one repository that matters passed the old check. Given a repository, this
 * sends one cheap request per permission the GitHub tabs use and reports each answer on its own —
 * status, the cause in words, the permission GitHub said it needed, and GitHub's message.
 *
 * It also says whether a token went with the requests at all, and to which API address: a token
 * that never left the keychain, or a github.com link read while an Enterprise server is
 * configured, looks from outside exactly like a token with no access.
 */
import type { GithubClient, Probe, TokenInfo } from './client'
import { GithubError } from './client'
import { header } from './refusal'

export interface RepoRef {
  host: string
  owner: string
  repo: string
}

const NAME = /^[\w.-]+$/

/**
 * A repository from what a person pastes: `owner/name`, any link into it on the web, or its API
 * address. Anything after the name — `/pull/12/files`, `/tree/main` — is ignored.
 */
export function parseRepoInput(input: string, defaultHost: string): RepoRef | null {
  const text = input.trim()
  if (!text) return null

  const short = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(text)
  if (short) return { host: defaultHost, owner: short[1], repo: short[2] }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  let host = url.hostname.toLowerCase().replace(/^www\./, '')
  let segments = url.pathname.split('/').filter(Boolean)

  if (host === 'api.github.com') host = 'github.com'
  else if (host.startsWith('api.') && host.endsWith('.ghe.com')) host = host.slice(4)
  if (segments[0] === 'api' && segments[1] === 'v3') segments = segments.slice(2)
  if (segments[0] === 'repos') segments = segments.slice(1)

  const [owner, rawRepo] = segments
  const repo = rawRepo?.replace(/\.git$/, '')
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return null
  if (owner === 'orgs' || owner === 'enterprises' || owner === 'settings') return null
  return { host, owner, repo }
}

export type RowState = 'ok' | 'refused' | 'skipped'

export interface AccessRow {
  permission: string
  /** What was asked, as `GET /repos/…` — the address without the host. */
  request: string
  state: RowState
  status?: number
  /** The cause, for a refusal; what the answer means, for an answer worth explaining. */
  reason?: string
  fix?: string
  needed?: string
  githubSaid?: string
}

export interface AccessReport {
  api: string
  token: TokenInfo
  /** Why no token was sent although one is set, when that is the case. */
  tokenNote?: string
  login?: string
  /** Why `/user` failed, when it did. */
  identityError?: string
  /** When the token stops working, as GitHub reports it for a token with an expiry. */
  expires?: string
  /** A classic token's scopes. */
  scopes?: string
  rateLimit?: string
  repo?: RepoRef
  rows: AccessRow[]
}

export interface AccessCheckInput {
  client: GithubClient
  repo: RepoRef | null
  /** A token is set in the settings on this device, whichever client ends up used. */
  tokenConfigured: boolean
  /** The host the configured token belongs to. */
  tokenHost: string
}

const repoPath = (r: RepoRef) =>
  `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`

function rowFrom(permission: string, path: string, probe: Probe): AccessRow {
  const row: AccessRow = {
    permission,
    request: `GET ${path}`,
    state: probe.error ? 'refused' : 'ok',
    status: probe.status,
  }
  if (!probe.error) return row
  if (probe.error.kind === 'empty') return { ...row, state: 'ok', reason: probe.error.reason }
  return {
    ...row,
    reason: probe.error.reason,
    fix: probe.error.fix,
    needed: probe.error.needed,
    githubSaid: probe.error.githubSaid,
  }
}

async function safely(permission: string, path: string, run: () => Promise<Probe>) {
  try {
    return rowFrom(permission, path, await run())
  } catch (e) {
    return {
      permission,
      request: `GET ${path}`,
      state: 'refused' as const,
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}

const DISCUSSIONS_QUERY = `
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    hasDiscussionsEnabled
    discussions(first: 1) { totalCount }
  }
}`

async function discussionsRow(client: GithubClient, repo: RepoRef): Promise<AccessRow> {
  const request = 'POST /graphql (discussions)'
  if (!client.hasToken) {
    return {
      permission: 'Discussions',
      request,
      state: 'skipped',
      reason: 'GitHub shows discussions only to a request that carries a token.',
    }
  }
  try {
    const data = await client.graphql<{
      repository?: { hasDiscussionsEnabled?: boolean; discussions?: { totalCount: number } }
    }>(DISCUSSIONS_QUERY, { owner: repo.owner, repo: repo.repo }, 'the discussions')
    const enabled = data.repository?.hasDiscussionsEnabled
    return {
      permission: 'Discussions',
      request,
      state: 'ok',
      status: 200,
      reason: enabled === false ? 'Discussions are turned off in this repository.' : undefined,
    }
  } catch (e) {
    const err = e instanceof GithubError ? e : null
    return {
      permission: 'Discussions',
      request,
      state: 'refused',
      status: err?.status || undefined,
      reason: err?.reason ?? (e instanceof Error ? e.message : String(e)),
      fix: err?.fix,
      needed: err?.needed,
      githubSaid: err?.githubSaid,
    }
  }
}

export async function checkAccess({
  client,
  repo,
  tokenConfigured,
  tokenHost,
}: AccessCheckInput): Promise<AccessReport> {
  const report: AccessReport = {
    api: client.endpoints.api,
    token: client.tokenInfo,
    repo: repo ?? undefined,
    rows: [],
  }

  if (tokenConfigured && !client.hasToken && repo && repo.host !== tokenHost) {
    report.tokenNote = `The token belongs to ${tokenHost}, and this repository is on ${repo.host}, so it is read without the token.`
  } else if (tokenConfigured && !client.hasToken) {
    report.tokenNote =
      'A token is set in the settings, but the keychain on this device returned nothing for it. Paste the token again on this device.'
  }

  const identity = client.hasToken
    ? client.probe<{ login?: string }>('/user', { what: 'the account the token belongs to' })
    : client.probe<{ rate?: { remaining: number; limit: number } }>('/rate_limit', {
        what: 'the request limit',
      })

  const rows: Promise<AccessRow>[] = []
  if (repo) {
    const base = repoPath(repo)
    const rest = (permission: string, path: string, what: string) =>
      safely(permission, path, () => client.probe(path, { what }))
    rows.push(
      rest('Metadata', base, 'the repository'),
      rest('Contents', `${base}/contents`, "the repository's files"),
      rest('Issues', `${base}/issues?per_page=1`, "the repository's issues"),
      rest('Pull requests', `${base}/pulls?per_page=1`, "the repository's pull requests"),
      discussionsRow(client, repo)
    )
  }

  const [who, ...answered] = await Promise.all([
    identity.catch((e: unknown) => e as Error),
    ...rows,
  ])
  report.rows = answered

  if (who instanceof Error) {
    report.identityError = who.message
  } else if (who.error) {
    report.identityError = who.error.message
  } else {
    const body = who.body as { login?: string; rate?: { remaining: number; limit: number } } | null
    report.login = body?.login
    report.expires = header(who.headers, 'github-authentication-token-expiration')
    report.scopes = header(who.headers, 'x-oauth-scopes')
    const remaining = body?.rate?.remaining ?? header(who.headers, 'x-ratelimit-remaining')
    const limit = body?.rate?.limit ?? header(who.headers, 'x-ratelimit-limit')
    if (remaining !== undefined && limit !== undefined) {
      report.rateLimit = `${remaining} of ${limit} requests left this hour`
    }
  }
  return report
}
