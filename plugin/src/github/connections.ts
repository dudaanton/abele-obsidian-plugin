import { endpoints } from './urls'
import type { GithubSettings } from './settings'

/** Stable, non-secret identifier; names and discovered logins may change independently. */
export interface GithubConnection {
  id: string
  name: string
  server: string
  keyId: string
  owners: string[]
  isDefault: boolean
  account?: { login: string; avatarUrl?: string }
  checkedAt?: number
  expiresAt?: string
}

const serverId = (address: string): string => endpoints(address).origin

/** A persisted list always wins over the compatibility fields, including an empty list. */
export function normalizeConnections(
  raw: unknown,
  legacy: { server?: string; keyId?: string }
): GithubConnection[] {
  const old = typeof legacy.server === 'string' ? legacy.server : ''
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
  const incoming: unknown[] = Array.isArray(raw) ? raw : migrated
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
    if (inputServer && !validConnectionServer(inputServer)) continue
    const server = inputServer && endpoints(inputServer).webHost === 'github.com' ? '' : inputServer
    const identity = serverId(server)
    const isDefault = c.isDefault === true && !defaults.has(identity)
    if (isDefault) defaults.add(identity)
    seen.add(c.id)
    result.push({
      id: c.id,
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
      ...(typeof c.expiresAt === 'string' ? { expiresAt: c.expiresAt } : {}),
    })
  }
  for (const c of result) {
    const identity = serverId(c.server)
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
      (url.pathname === '/' || url.pathname === '/api/v3' || url.pathname === '/api/graphql') &&
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
  return connections.find((c) => !c.server && c.isDefault) ?? connections.find((c) => c.isDefault)
}

/** One old-version device can represent only one server. Retain the migrated server while present. */
export function projectLegacy(settings: GithubSettings): GithubSettings {
  const chosen =
    settings.connections.find(
      (c) =>
        c.isDefault && serverId(c.server) === serverId(settings.legacyServer ?? settings.server)
    ) ?? preferredConnection(settings.connections)
  const oldOrigin = endpoints(settings.legacyServer ?? settings.server).origin
  const bare = /^[^:/\s]+\/[^:/\s]+$/.test(settings.defaultRepo)
  return {
    ...settings,
    keyId: chosen?.keyId ?? '',
    server: chosen?.server ?? '',
    legacyServer: chosen ? (settings.legacyServer ?? settings.server) : '',
    defaultRepo: bare ? `${oldOrigin}/${settings.defaultRepo}` : settings.defaultRepo,
    connections: settings.connections.map((c) => ({
      ...c,
      owners: [...c.owners],
      account: c.account && { ...c.account },
    })),
  }
}
