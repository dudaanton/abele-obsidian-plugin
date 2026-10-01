import { ConnectionFallback } from './connectionFallback'
import { primaryAccess } from './primaryAccess'
import { loadItem, type ItemData } from './loadItem'
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
  retry = false
): Promise<{
  connectionId: string
  data: ItemData
  shown: GithubTarget
  notice: string
}> {
  const candidates = resolveConnectionCandidates(target, {
    sourceId: model.connectionId,
    explicitId: model.connectionIntent === 'manual' ? model.connectionId : undefined,
    allowedIds: model.allowedConnections,
  })
  const result = await fallback.read({
    candidates,
    retry,
    repo: `${target.origin ?? `https://${target.host}`}/${target.owner}/${target.repo}`,
    item: targetKey(target),
    generation: connectionGeneration,
    manual: model.connectionIntent === 'manual',
    read: async (id) => {
      const client = id ? connectionClient(id) : githubClient(target.host)
      await primaryAccess(client,target)
      return client
    },
  })
  // All optional sections load only after choosing the identity. A failure in one of them
  // cannot trigger another account probe or overwrite the successful routing preference.
  let shown = target
  const data = await loadItem(result.value,target,promoted => { shown = promoted })
  const name = (id: string) =>
    githubSettings().connections.find((c) => c.id === id)?.name ?? 'Anonymous'
  return {
    connectionId: result.id,
    data, shown,
    notice: result.attempts.length
      ? `Opened as ${name(result.id)}. ${result.attempts.map((a) => `${name(a.id)}: ${a.error}`).join(' ')}`
      : '',
  }
}
