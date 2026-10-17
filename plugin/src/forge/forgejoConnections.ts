import { effectScope, watch, reactive } from 'vue'
import { ancestors, findNode } from '@/github/tree/fileTree'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from '@/secrets/SecretStore'
import { singleHopRequest } from '@/github/transport'
import { deployment } from './identity'
import { ForgejoClient } from './forgejoClient'
import { forgejoRepository } from './forgejoRepository'
import type { HttpTransport } from './transport'
import type { RepositorySource } from '@/repository/source'

let sequence = 0
interface Authority {
  signature: string
  generation: string
  retired: boolean
}
const authorities = new Map<string, Authority>()
const sources = new Map<string, { authority: Authority; source: RepositorySource }>()
let watching: { version: unknown; secrets: unknown; stop: () => void } | undefined
function signature(id: string): string {
  const c = AbeleConfig.getInstance().github.connections.find((r) => r.id === id)
  return c
    ? JSON.stringify([
        c.provider,
        c.server,
        c.keyId,
        c.keyId ? secrets().get(c.keyId) : '',
        secrets().status.value,
      ])
    : ''
}
function reconcile() {
  for (const [id, authority] of authorities) {
    if (authority.signature !== signature(id)) {
      authority.retired = true
      authorities.delete(id)
    }
  }
}
function watchAuthorities() {
  const version = AbeleConfig.getInstance().version,
    secretVersion = secrets().version
  if (watching?.version === version && watching.secrets === secretVersion) return
  watching?.stop()
  for (const authority of authorities.values()) authority.retired = true
  authorities.clear()
  sources.clear()
  const scope = effectScope(true)
  scope.run(() => watch([version, secretVersion, secrets().status], reconcile, { flush: 'sync' }))
  watching = { version, secrets: secretVersion, stop: () => scope.stop() }
}
export function forgejoConnectionSource(
  id: string,
  repository: string,
  transport?: HttpTransport
): RepositorySource {
  const row = () => AbeleConfig.getInstance().github.connections.find((r) => r.id === id)
  const current = row()
  if (!current || current.provider !== 'forgejo')
    throw new Error('The Forgejo connection was removed or changed.')
  watchAuthorities()
  reconcile()
  let authority = authorities.get(id)
  if (!authority) {
    authority = { signature: signature(id), generation: `forgejo-${++sequence}`, retired: false }
    authorities.set(id, authority)
  }
  const captured = authority,
    key = JSON.stringify([id, repository])
  const previous = sources.get(key)
  if (!transport && previous?.authority === captured) return previous.source
  const token = current.keyId ? (secrets().get(current.keyId) ?? '').trim() : ''
  const source = forgejoRepository(
    new ForgejoClient(
      deployment('forgejo', current.server),
      {
        connectionId: id,
        generation: captured.generation,
        assertCurrent: () => {
          if (captured.retired || captured.signature !== signature(id))
            throw new Error('The Forgejo connection was removed or changed; reload this tab.')
          if (current.keyId && !token)
            throw new Error(
              'The connection token is unavailable on this device; unlock synced keys or add the token.'
            )
        },
      },
      transport ?? singleHopRequest,
      token
    ),
    repository
  )
  const nativeTree = source.tree.bind(source)
  source.tree = async (sha) => {
    const tree = await nativeTree(sha),
      root = reactive(tree.root)
    return {
      ...tree,
      root,
      reveal: async (path) => {
        for (const at of ancestors(path)) {
          const node = findNode(root, at)
          if (node) await tree.expand(node)
        }
      },
    }
  }
  if (!transport) {
    sources.set(key, { authority: captured, source })
    if (sources.size > 32) sources.delete(sources.keys().next().value)
  }
  return source
}
