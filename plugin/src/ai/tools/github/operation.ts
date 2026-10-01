import { GlobalStore } from '@/stores/GlobalStore'
import {
  authorizeConnection,
  connectionMode,
  type ConnectionAgent,
  type ConnectionApproval,
} from '@/github/agentAccess'
import {
  connectionClient,
  githubSettings,
  GITHUB_VIEW_TYPE,
  resolveConnectionCandidates,
} from '@/github/GithubService'
import { preferredConnection, type GithubConnection } from '@/github/connections'
import { endpoints, parseGithubUrl, type GithubTarget } from '@/github/urls'
import { parseRepoInput } from '@/github/accessCheck'
import { GithubClient } from '@/github/client'
import { guardedGithubClient } from '@/github/guardedClient'
import type { GithubViewModel } from '@/github/model'
import type { GithubToolOperation } from './shared'

export interface GithubToolAccess {
  agent: () => ConnectionAgent | null | undefined
  approve?: ConnectionApproval
}
const anonymous = new GithubClient(endpoints(''), '')

export async function toolOperation(
  name: string,
  params: Record<string, unknown>,
  access: GithubToolAccess,
  signal?: AbortSignal
): Promise<GithubToolOperation> {
  const rows = githubSettings().connections ?? []
  const originalAgent = access.agent()?.id
  const selected = typeof params.connection === 'string' ? params.connection.trim() : ''
  let connection: GithubConnection | undefined
  if (selected) {
    const matches = rows.filter((c) => c.id === selected || c.name === selected)
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? 'Ambiguous GitHub connection name; use its unique ID.'
          : 'Unknown GitHub connection. Use github_views to list connections.'
      )
    connection = matches[0]
  }
  const { app } = GlobalStore.getInstance()
  const tabs = (app?.workspace?.getLeavesOfType?.(GITHUB_VIEW_TYPE) ?? [])
    .map((l) => (l.view as unknown as { model?: GithubViewModel }).model)
    .filter(Boolean)
  const input = String(params.item ?? params.repo ?? params.url ?? '').trim()
  let target: GithubTarget | null = null
  const preferred = preferredConnection(rows)
  if (input) {
    const e = endpoints(connection?.server ?? preferred?.server ?? '')
    const short = /^([\w.-]+)\/([\w.-]+)(?:#(\d+))?$/.exec(input)
    if (short)
      target = short[3]
        ? {
            kind: 'issue',
            host: e.webHost,
            origin: e.origin,
            owner: short[1],
            repo: short[2],
            number: Number(short[3]),
          }
        : { kind: 'repo', host: e.webHost, origin: e.origin, owner: short[1], repo: short[2] }
    else {
      const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
      if (url.username || url.password) throw new Error('GitHub URLs must not contain credentials.')
      target = parseGithubUrl(input, [
        ...new Set(['github.com', ...rows.map((c) => endpoints(c.server).webHost)]),
      ])
      if (target) target.origin = new URL(input).origin
      else {
        const repo = parseRepoInput(input, e.webHost)
        if (repo)
          target = {
            kind: 'repo',
            ...repo,
            origin: new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`).origin,
          }
      }
    }
  }
  if (target?.origin) {
    const apiAlias = rows.find((c) => new URL(endpoints(c.server).api).origin === target!.origin)
    if (apiAlias && endpoints(apiAlias.server).webHost === target.host)
      target.origin = endpoints(apiAlias.server).origin
  }
  if (!connection && name !== 'github_views') {
    if (target) {
      const shown = tabs.find(
        (m) =>
          m?.target?.host === target!.host &&
          m.target.owner === target!.owner &&
          m.target.repo === target!.repo
      )
      if (shown?.connectionId && connectionMode(access.agent(), shown.connectionId) === 'off') {
        throw new Error('The matching open GitHub tab uses a connection this agent cannot access.')
      }
      const candidate = resolveConnectionCandidates(target, {
        openId: shown?.connectionId,
        allowedIds: rows.filter(c=>connectionMode(access.agent(),c.id)!=='off').map(c=>c.id),
      })[0]
      connection = rows.find((c) => c.id === candidate?.id)
      if (!candidate) throw new Error('No permitted GitHub connection is available for this server.')
    } else connection = preferred
  }
  if (connection && target) {
    const e = endpoints(connection.server)
    const targetUrl = new URL(target.origin ?? `https://${target.host}`)
    const web = new URL(e.origin)
    if (
      target.host !== e.webHost ||
      targetUrl.protocol !== web.protocol ||
      targetUrl.port !== web.port
    ) {
      throw new Error(
        'The repository URL is on a different server than the selected GitHub connection.'
      )
    }
  }
  if (target?.kind === 'issue' && name === 'github_pr_files')
    target = { ...target, kind: 'pull', tab: 'files' }
  if (target?.kind === 'repo' && (name === 'github_file' || name === 'github_grep')) {
    const ref = typeof params.ref === 'string' && params.ref ? params.ref : 'HEAD'
    const path = typeof params.path === 'string' ? params.path : ''
    target =
      name === 'github_file' && path && !params.recursive
        ? { ...target, kind: 'blob', rest: [ref, ...path.split('/')] }
        : { ...target, kind: 'tree', rest: [ref] }
  }
  const candidates = target
    ? resolveConnectionCandidates(target, {
        sourceId: connection?.id,
        allowedIds: rows
          .filter((c) => connectionMode(access.agent(), c.id) !== 'off')
          .map((c) => c.id),
      }).map((c) => c.id)
    : []
  const client = connection ? connectionClient(connection.id) : anonymous
  const generation = client.cacheNamespace
  let approved = ''
  const asked = connection && connectionMode(access.agent(), connection.id) === 'ask'
  if (connection) {
    await authorizeConnection(access.agent, connection, access.approve, signal)
    if (connectionClient(connection.id).cacheNamespace !== generation)
      throw new Error(
        'The GitHub connection changed while awaiting approval. Ask again for its current endpoint and token.'
      )
    approved = asked ? connection.id : ''
  }
  if (!connection && name !== 'github_views' && target && target.host !== 'github.com')
    throw new Error('No permitted connection is available for this server.')
  const assertAccess = () => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (originalAgent !== access.agent()?.id)
      throw new Error('The executing agent changed during the GitHub operation.')
    if (connection) {
      const mode = connectionMode(access.agent(), connection.id)
      if (mode === 'off' || (mode === 'ask' && approved !== connection.id))
        throw new Error('GitHub connection access was revoked.')
      if (connectionClient(connection.id).cacheNamespace !== generation)
        throw new Error('The GitHub connection changed during this operation.')
    }
  }
  const canReadTab = (id: string | undefined) => {
    if (!id) return true
    if (!(githubSettings().connections ?? []).some((c) => c.id === id)) return false
    if (selected && id !== connection?.id) return false
    return connectionMode(access.agent(), id) === 'auto' || id === approved
  }
  const inventory = [
    'GitHub connections (Off / Ask / On):',
    ...rows.map(
      (c) =>
        `- ${c.name} [${c.id}] — ${c.server || 'github.com'}${c.account ? ` · ${c.account.login}` : ''} — ${connectionMode(access.agent(), c.id) === 'auto' ? 'On' : connectionMode(access.agent(), c.id) === 'ask' ? 'Ask' : 'Off'}`
    ),
  ].join('\n')
  const guardedClient = guardedGithubClient(client, assertAccess)
  return {
    connectionId: connection?.id ?? '',
    agentId: originalAgent,
    approvedConnections: approved ? { [approved]: generation } : {},
    explicit: !!selected,
    target: target ?? undefined,
    candidates,
    client: guardedClient,
    assertAccess,
    canReadTab,
    inventory,
    allowedIds: rows.filter((c) => canReadTab(c.id)).map((c) => c.id),
  }
}
