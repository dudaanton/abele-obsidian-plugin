import { endpoints } from './urls'
import type { GithubSettings } from './settings'
import { deployment } from '@/forge/identity'

import type { ForgeConnection as GithubConnection } from '@/forge/model'
export type { ForgeConnection as GithubConnection } from '@/forge/model'

const serverId = (address: string): string => endpoints(address).origin

export const isGithubConnection = (connection: Pick<GithubConnection, 'provider'>): boolean =>
  connection.provider === undefined || connection.provider === 'github'

/** Repository browsing is separate from the GitHub tools and notification adapters. */
export const isBrowsableConnection = (connection: Pick<GithubConnection, 'provider'>): boolean =>
  isGithubConnection(connection) || connection.provider === 'forgejo'

/** Retained records are manageable before their provider's client is installed. */
export function connectionUnavailableReason(
  connection: Pick<GithubConnection, 'provider'>
): string {
  if (isGithubConnection(connection)) return ''
  const names: Record<string, string> = { forgejo: 'Forgejo', gitea: 'Gitea', gitlab: 'GitLab' }
  return `${names[connection.provider] ?? connection.provider}, available in a later version`
}

export function connectionBinding(
  connection: Pick<GithubConnection, 'provider' | 'server'>
): string {
  return isGithubConnection(connection)
    ? JSON.stringify(['github', serverId(connection.server)])
    : JSON.stringify([connection.provider, deployment('forgejo', connection.server).webBase])
}

export function validProviderServer(
  connection: Pick<GithubConnection, 'provider' | 'server'>
): boolean {
  if (isGithubConnection(connection))
    return !connection.server || validConnectionServer(connection.server)
  try {
    deployment('forgejo', connection.server)
    return typeof connection.provider === 'string' && /^[a-z][a-z0-9-]*$/.test(connection.provider)
  } catch {
    return false
  }
}

/** A persisted list always wins over the compatibility fields, including an empty list. */
export function normalizeConnections(
  raw: unknown,
  legacy: { server?: string; keyId?: string }
): GithubConnection[] {
  if (raw === undefined && legacy.server !== undefined && typeof legacy.server !== 'string')
    return []
  const old = typeof legacy.server === 'string' ? legacy.server.trim() : ''
  const keyId = typeof legacy.keyId === 'string' ? legacy.keyId : ''
  const migrated =
    old || keyId
      ? [
          {
            id: 'github-legacy',
            name: old ? 'GitHub Enterprise' : 'GitHub',
            server: old,
            keyId,
            owners: [] as string[],
            isDefault: true,
          },
        ]
      : []
  const incoming: unknown[] = raw === undefined ? migrated : Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const defaults = new Set<string>()
  const result: GithubConnection[] = []
  for (const row of incoming) {
    if (!row || typeof row !== 'object') continue
    const c = row as Partial<GithubConnection>
    if (
      typeof c.id !== 'string' ||
      !c.id ||
      seen.has(c.id) ||
      typeof c.name !== 'string' ||
      typeof c.server !== 'string' ||
      typeof c.keyId !== 'string'
    )
      continue
    // Invalid server syntax must never silently map credentials to public GitHub.
    const inputServer = c.server.trim()
    if (!validProviderServer({ ...c, server: inputServer })) continue
    const server = isGithubConnection(c)
      ? inputServer && endpoints(inputServer).webHost === 'github.com'
        ? ''
        : inputServer
      : deployment('forgejo', inputServer).webBase
    const identity = connectionBinding({ ...c, server })
    const isDefault = c.isDefault === true && !defaults.has(identity)
    if (isDefault) defaults.add(identity)
    seen.add(c.id)
    result.push({
      id: c.id,
      ...(c.provider !== undefined ? { provider: c.provider } : {}),
      name: c.name,
      server,
      keyId: c.keyId,
      owners: Array.isArray(c.owners)
        ? c.owners.filter((p): p is string => typeof p === 'string')
        : [],
      isDefault,
      ...(typeof c.account?.login === 'string'
        ? {
            account: {
              login: c.account.login,
              ...(typeof c.account.avatarUrl === 'string'
                ? { avatarUrl: c.account.avatarUrl }
                : {}),
            },
          }
        : {}),
      ...(typeof c.checkedAt === 'number' ? { checkedAt: c.checkedAt } : {}),
      ...(c.checkState && ['ok', 'partial', 'refused', 'error'].includes(c.checkState)
        ? { checkState: c.checkState }
        : {}),
      ...(typeof c.expiresAt === 'string' ? { expiresAt: c.expiresAt } : {}),
    })
  }
  for (const c of result) {
    const identity = connectionBinding(c)
    if (!defaults.has(identity)) {
      c.isDefault = true
      defaults.add(identity)
    }
  }
  return result
}

export function validConnectionServer(address: string): boolean {
  try {
    const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`)
    const host = url.hostname
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^www\./, '')
    const publicHost = host === 'github.com' || host.endsWith('.github.com')
    const residency = host.endsWith('.ghe.com')
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      ['', '/api/v3', '/api/graphql'].includes(url.pathname.replace(/\/+$/, '')) &&
      !url.search &&
      !url.hash &&
      !!url.hostname &&
      ((!publicHost && !residency) || (url.protocol === 'https:' && !url.port))
    )
  } catch {
    return false
  }
}

export function preferredConnection(connections: GithubConnection[]): GithubConnection | undefined {
  const github = connections.filter(isGithubConnection)
  return github.find((c) => !c.server && c.isDefault) ?? github.find((c) => c.isDefault)
}

/** One old-version device can represent only one server. Retain the migrated server while present. */
export function projectLegacy(settings: GithubSettings): GithubSettings {
  const chosen =
    settings.connections.find(
      (c) =>
        isGithubConnection(c) &&
        c.isDefault &&
        serverId(c.server) === serverId(settings.legacyServer ?? settings.server)
    ) ?? preferredConnection(settings.connections)
  const oldOrigin = endpoints(settings.legacyServer ?? settings.server).origin
  const bare = /^[^:/\s]+\/[^:/\s]+$/.test(settings.defaultRepo)
  return {
    ...settings,
    keyId: chosen?.keyId ?? '',
    server: chosen?.server ?? '',
    legacyServer: chosen?.server ?? '',
    defaultRepo: bare ? `${oldOrigin}/${settings.defaultRepo}` : settings.defaultRepo,
    notifications: {
      ...settings.notifications,
      // Old versions attach this slot to the projected server. Hide it if that would send
      // the classic token to a different API; the new version retains the bound slot below.
      keyId:
        serverId(chosen?.server ?? '') ===
        serverId(settings.notifications.boundServer ?? settings.server)
          ? (settings.notifications.boundKeyId ?? settings.notifications.keyId)
          : '',
    },
    connections: settings.connections.map((c) => ({
      ...c,
      owners: [...c.owners],
      account: c.account && { ...c.account },
    })),
  }
}
