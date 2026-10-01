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
    approvedConnections: model.approvedConnections && [...model.approvedConnections],
  }
}

export function tabConnectionAllowed(scope: TabAccess, id: string): boolean {
  if (!scope.allowedConnections) return true
  if (!id) return true
  const agent = scope.executionAgentId
    ? AgentRegistry.getInstance().get(scope.executionAgentId)
    : null
  const mode = connectionMode(agent, id)
  return (
    scope.allowedConnections.includes(id) &&
    (mode === 'auto' || (mode === 'ask' && !!scope.approvedConnections?.includes(id)))
  )
}

/** All primary and secondary reads of an agent-opened tab carry the same live capability. */
export function clientForTab(model: TabAccess, id: string, client: GithubClient): GithubClient {
  if (!model.allowedConnections) return client
  const scope = tabAccessSnapshot(model),
    generation = client.cacheNamespace
  return guardedGithubClient(
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
}
