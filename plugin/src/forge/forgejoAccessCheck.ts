import type { AccessReport, AccessRow, RepoRef } from '@/github/accessCheck'
import { ForgejoClient, ForgejoError } from './forgejoClient'
import { forgejoUrls } from './forgejoUrls'

export function forgejoRepoInput(client: ForgejoClient, input: string): RepoRef | null {
  if (/^[\w.-]+\/[\w.-]+$/.test(input) && !input.split('/').some((p) => ['.', '..'].includes(p))) {
    const [owner, repo] = input.split('/')
    return {
      owner,
      repo,
      host: new URL(client.deployment.webBase).hostname,
      origin: client.deployment.webBase,
    }
  }
  const target = forgejoUrls(client.deployment).parse(input)
  return target
    ? { owner: target.owner, repo: target.repo, host: target.host, origin: target.origin }
    : null
}
export async function checkForgejoAccess(
  client: ForgejoClient,
  repo: RepoRef | null,
  token: string
): Promise<AccessReport> {
  const host = new URL(client.deployment.webBase).host
  const report: AccessReport = {
    api: client.deployment.apiBase,
    host,
    tokenHost: host,
    tokenConfigured: !!token,
    token: { attached: !!token, length: token.length, kind: token ? 'unknown' : 'none' },
    rows: [],
    ...(repo ? { repo } : {}),
  }
  try {
    const account = await client.get<{ login: string }>('/user')
    report.login = account.login
  } catch (error) {
    client.session.assertCurrent()
    report.identityError =
      error instanceof Error ? error.message : 'The account could not be checked.'
  }
  if (repo) {
    const path = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`
    for (const [permission, endpoint] of [
      ['Repository', path],
      ['Contents', `${path}/contents`],
      ['Issues', `${path}/issues?limit=1`],
      ['Pull requests', `${path}/pulls?limit=1`],
    ]) {
      const row: AccessRow = { permission, request: `GET ${endpoint}`, state: 'ok', status: 200 }
      try {
        await client.get(endpoint)
      } catch (error) {
        client.session.assertCurrent()
        row.state = 'refused'
        row.status = error instanceof ForgejoError ? error.status : undefined
        row.reason = error instanceof Error ? error.message : 'The access check failed.'
        row.fix = 'Use a token with read access for this operation and repository.'
      }
      report.rows.push(row)
    }
  }
  return report
}
