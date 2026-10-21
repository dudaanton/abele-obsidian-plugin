import { reactive } from 'vue'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { contentHash } from '@/ai/readGuard'
import { providerLabel } from './providers'

export interface ObsidianRunner {
  state: 'device' | 'none'
  device?: string
}
export const nodeToolRunners = reactive<Record<string, ObsidianRunner>>({})

/** Stable node/provider identities survive reconnect and ordinary agent-settings transfer. */
export function ensureNodeAgents(nodeId: string, name: string, providers: string[]) {
  const registry = AgentRegistry.getInstance()
  return providers
    .filter((provider) => ['claude', 'pi', 'codex', 'fake'].includes(provider))
    .map((provider) => {
      const id = `node_${contentHash(nodeId)}_${provider}`
      return (
        registry.get(id) ??
        registry.create({
          id,
          name: providerLabel(provider),
          utility: true,
          // A node folder is a native filesystem target, not a vault folder grant. The
          // Obsidian executor is bound to this vault; its individual tools govern access.
          fullVaultAccess: true,
          description: name,
          node: { id: nodeId, name, provider },
        })
      )
    })
}
