import type { GithubConnection } from './connections'
import { endpoints, normaliseHost } from './urls'

export interface RoutingInput {
  host: string
  origin?: string
  owner: string
  repo: string
  sourceId?: string
  openId?: string
  rememberedId?: string
  explicitId?: string
  allowed?: (connection: GithubConnection) => boolean
}
export interface ConnectionCandidate {
  id: string
  reason:
    | 'explicit'
    | 'source'
    | 'open'
    | 'owner'
    | 'remembered'
    | 'default'
    | 'alternative'
    | 'anonymous'
}

/** Link aliases are not authenticated destinations: schemes and ports still distinguish servers. */
export function sameConnectionServer(
  connection: GithubConnection,
  target: Pick<RoutingInput, 'host' | 'origin'>
): boolean {
  const e = endpoints(connection.server)
  if (e.webHost !== normaliseHost(target.host)) return false
  if (!target.origin) return true
  try {
    const link = new URL(target.origin),
      web = new URL(e.origin)
    return (
      link.protocol === web.protocol &&
      link.port === web.port &&
      normaliseHost(link.hostname) === e.webHost
    )
  } catch {
    return false
  }
}

/** Only '*' is a wildcard; no regular expression from settings is ever evaluated. */
function specificity(pattern: string, owner: string, repo: string): number {
  const p = pattern.trim().toLowerCase(),
    o = owner.toLowerCase(),
    r = repo.toLowerCase()
  if (p === `${o}/${r}`) return 3000 + p.length
  if (p === o || p === `${o}/*`) return 2000 + o.length
  if (!p.includes('*') || p.includes('/')) return -1
  const escaped = p
    .split('*')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`).test(o) ? 1000 + p.replace(/\*/g, '').length : -1
}

export function routeConnections(
  connections: GithubConnection[],
  input: RoutingInput
): ConnectionCandidate[] {
  const serverRows = connections.filter((c) => sameConnectionServer(c, input))
  // Host-only targets cannot choose between servers sharing a hostname but differing by port/scheme.
  if (!input.origin && new Set(serverRows.map((c) => endpoints(c.server).origin)).size > 1)
    return []
  const rows = serverRows.filter((c) => !input.allowed || input.allowed(c))
  if (input.explicitId !== undefined) {
    if (input.explicitId === '' && !serverRows.length && normaliseHost(input.host) === 'github.com')
      return [{ id: '', reason: 'anonymous' }]
    const chosen = connections.find((c) => c.id === input.explicitId)
    if (!chosen) throw new Error('The requested GitHub connection is unknown or was deleted.')
    if (!serverRows.includes(chosen))
      throw new Error('The requested GitHub connection belongs to another server.')
    if (!rows.includes(chosen))
      throw new Error('This agent may not use the requested GitHub connection.')
    return [{ id: chosen.id, reason: 'explicit' }]
  }
  if (!serverRows.length && normaliseHost(input.host) === 'github.com')
    return [{ id: '', reason: 'anonymous' }]
  const out: ConnectionCandidate[] = []
  const add = (id: string | undefined, reason: ConnectionCandidate['reason']) => {
    if (id && rows.some((c) => c.id === id) && !out.some((c) => c.id === id))
      out.push({ id, reason })
  }
  add(input.sourceId, 'source')
  add(input.openId, 'open')
  const rules = rows
    .map((c, order) => ({
      c,
      order,
      score: Math.max(-1, ...c.owners.map((p) => specificity(p, input.owner, input.repo))),
    }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
  for (const r of rules) add(r.c.id, 'owner')
  add(input.rememberedId, 'remembered')
  add(rows.find((c) => c.isDefault)?.id, 'default')
  for (const row of rows) add(row.id, 'alternative')
  return out
}

/** Runtime only. Refusals name an item/capability, never poison the entire repository. */
export class ConnectionMemory {
  private refusals = new Map<string, number>()
  private successes = new Map<string, { id: string; generation: string }>()
  constructor(private readonly now: () => number = Date.now) {}
  refused(id: string, generation: string, item: string): void {
    this.refusals.set(JSON.stringify([id, generation, item]), this.now() + 600000)
    if (this.refusals.size > 1000) this.refusals.delete(this.refusals.keys().next().value as string)
  }
  wasRefused(id: string, generation: string, item: string): boolean {
    const key = JSON.stringify([id, generation, item]),
      expiry = this.refusals.get(key)
    if (expiry === undefined) return false
    if (expiry <= this.now()) {
      this.refusals.delete(key)
      return false
    }
    return true
  }
  succeeded(repo: string, id: string, generation: string): void {
    this.successes.set(repo.toLowerCase(), { id, generation })
    if (this.successes.size > 1000)
      this.successes.delete(this.successes.keys().next().value as string)
  }
  success(repo: string, generation: (id: string) => string): string | undefined {
    const found = this.successes.get(repo.toLowerCase())
    return found && generation(found.id) === found.generation ? found.id : undefined
  }
}
