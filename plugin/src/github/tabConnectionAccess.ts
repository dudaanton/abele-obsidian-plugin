import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { connectionMode } from './agentAccess'
import { connectionGeneration } from './GithubService'
import { GithubError, type GithubClient } from './client'
import { guardedGithubClient } from './guardedClient'
import type { GithubViewModel } from './model'

type TabAccess = Pick<
  GithubViewModel,
  'allowedConnections' | 'executionAgentId' | 'approvedConnections'
>

/** Capture the executing principal; later user navigation must not widen an in-flight tool load. */
export function tabAccessSnapshot(model: TabAccess): TabAccess {
  return {
    allowedConnections: model.allowedConnections && [...model.allowedConnections],
    executionAgentId: model.executionAgentId,
    approvedConnections:
      model.approvedConnections && !Array.isArray(model.approvedConnections)
        ? Object.fromEntries(
            Object.entries(model.approvedConnections).filter(
              ([, value]) => typeof value === 'string'
            )
          )
        : {},
  }
}

export function tabConnectionAllowed(scope: TabAccess, id: string): boolean {
  if (!scope.allowedConnections) return true
  if (!id) return true
  const agent = scope.executionAgentId
    ? AgentRegistry.getInstance().get(scope.executionAgentId)
    : null
  const mode = connectionMode(agent, id)
  const approved = scope.approvedConnections?.[id]
  return (
    scope.allowedConnections.includes(id) &&
    (mode === 'auto' || (mode === 'ask' && !!approved && approved === connectionGeneration(id)))
  )
}

// Identical captured scopes reuse their wrapper and its session caches, while different
// principals, connection restrictions and grants never borrow each other's access guard.
const tabClients = new WeakMap<GithubClient, Map<string, GithubClient>>()

/** All primary and secondary reads of an agent-opened tab carry the same live capability. */
export function clientForTab(model: TabAccess, id: string, client: GithubClient): GithubClient {
  if (!model.allowedConnections) return client
  const scope = tabAccessSnapshot(model),
    generation = client.cacheNamespace
  const key = JSON.stringify([
    id,
    scope.executionAgentId,
    [...scope.allowedConnections!].sort(),
    Object.entries(scope.approvedConnections ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ])
  let cached = tabClients.get(client)
  if (!cached) {
    cached = new Map()
    tabClients.set(client, cached)
    const owned = cached
    client.onRetire?.(() => {
      owned.clear()
      tabClients.delete(client)
    })
  }
  const known = cached.get(key)
  if (known) {
    cached.delete(key)
    cached.set(key, known)
    return known
  }
  const guarded = guardedGithubClient(
    client,
    () => {
      if (!tabConnectionAllowed(scope, id) || (!id && client.hasToken)) {
        throw new GithubError('other', 'The agent no longer has access to this GitHub connection.')
      }
      if (id && connectionGeneration(id) !== generation)
        throw new GithubError('other', 'The GitHub connection changed during this tab load.')
    },
    true
  )
  cached.set(key, guarded)
  while (cached.size > 32) cached.delete(cached.keys().next().value!)
  return guarded
}
