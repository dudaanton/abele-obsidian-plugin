import { ConnectionFallback } from './connectionFallback'
import { primaryAccess } from './primaryAccess'
import { clientForTab, tabAccessSnapshot, tabConnectionAllowed } from './tabConnectionAccess'
import { GithubError } from './client'
import { loadItem, type ItemData, type PinnedLoad } from './loadItem'
import { comparisonService } from './comparison/service'
import {
  connectionClient,
  connectionGeneration,
  githubClient,
  githubSettings,
  resolveConnectionCandidates,
  routingMemory,
} from './GithubService'
import { targetKey, type GithubTarget } from './urls'
import type { GithubViewModel } from './model'

const fallback = new ConnectionFallback(routingMemory)

/** One tab load. Every attempt keeps its client and promotion local until the whole item loads. */
export async function readConnectionItem(
  model: GithubViewModel,
  target: GithubTarget,
  retry = false,
  pinned: PinnedLoad = {}
): Promise<{
  connectionId: string
  data: ItemData
  shown: GithubTarget
  notice: string
}> {
  const scope = tabAccessSnapshot(model)
  const permitted = (id: string) => tabConnectionAllowed(scope, id)
  const allowed = scope.allowedConnections?.filter(permitted)
  const candidates = resolveConnectionCandidates(target, {
    sourceId: model.connectionId,
    explicitId: model.connectionIntent === 'manual' ? model.connectionId : undefined,
    allowedIds: allowed,
  })
  const contexts = new Map(
    candidates.map((c) => [c.id, c.id ? connectionClient(c.id) : githubClient(target.host)])
  )
  const resolved = new Map<string, PinnedLoad['resolved']>()
  const result = await fallback.read({
    candidates,
    retry,
    repo: `${target.origin ?? `https://${target.host}`}/${target.owner}/${target.repo}`,
    item: targetKey(target),
    generation: connectionGeneration,
    label: (id) => githubSettings().connections.find((c) => c.id === id)?.name ?? 'Anonymous',
    manual: model.connectionIntent === 'manual',
    read: async (id) => {
      if (!permitted(id))
        throw new GithubError('other', 'The agent no longer has access to this GitHub connection.')
      const rawClient = contexts.get(id)!
      rawClient.assertCurrent()
      const client = clientForTab(scope, id, rawClient)
      if (pinned.base && target.kind === 'blob') {
        resolved.set(
          id,
          await comparisonService(client, target).resolve(
            pinned.resolved
              ? [pinned.resolved.sha, ...pinned.resolved.path.split('/')]
              : target.rest,
            pinned.base.baseSha,
            pinned.signal
          )
        )
      } else await primaryAccess(client, target)
      return client
    },
  })
  // All optional sections load only after choosing the identity. A failure in one of them
  // cannot trigger another account probe or overwrite the successful routing preference.
  let shown = target
  if (!permitted(result.id))
    throw new GithubError('other', 'The agent no longer has access to this GitHub connection.')
  const data = await loadItem(
    result.value,
    target,
    (promoted) => {
      shown = promoted
    },
    { ...pinned, resolved: resolved.get(result.id) }
  )
  if (!permitted(result.id))
    throw new GithubError('other', 'The agent no longer has access to this GitHub connection.')
  const name = (id: string) =>
    githubSettings().connections.find((c) => c.id === id)?.name ?? 'Anonymous'
  return {
    connectionId: result.id,
    data,
    shown,
    notice: result.attempts.length
      ? `Opened as ${name(result.id)}. ${result.attempts.map((a) => `${name(a.id)}: ${a.reason ?? a.error}`).join(' ')}`
      : '',
  }
}
