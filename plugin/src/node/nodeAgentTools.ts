import { SessionSettingsSchema } from '@abele/node-protocol'
import { reactive } from 'vue'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { contentHash } from '@/ai/readGuard'
import { providerLabel } from './providers'
import { t } from '@/i18n'

export function nodeAgentModeLabel(nodeId: string, provider: string): string {
  const mode = nodeAgentOwnerMode(nodeId, provider)
  if (!mode) return t('streamB.permissionUnknown')
  return t(mode === 'allow-all' ? 'streamB.permissionBypass' : 'streamB.permissionAsk')
}
export function nodeAgentOwnerMode(nodeId: string, provider: string): string | undefined {
  return AgentRegistry.getInstance().get(`node_${contentHash(nodeId)}_${provider}`)?.permissionMode
}

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

/** Only an explicit owner choice seeds future sessions; reported defaults never become preferences. */
export function rememberNodeAgentEffort(nodeId: string, provider: string, effort: string): void {
  const parsed = SessionSettingsSchema.safeParse({ effort })
  if (!parsed.success) return
  const registry = AgentRegistry.getInstance()
  const agent = ensureNodeAgents(nodeId, nodeId, [provider])[0]
  if (agent?.node) registry.update(agent.id, { node: { ...agent.node, effort } })
}

/** Snapshot for creation only: never applied to an existing chat. Absence leaves the node in charge. */
export function nodeAgentSessionSettings(nodeId: string, provider: string) {
  const effort = AgentRegistry.getInstance().get(`node_${contentHash(nodeId)}_${provider}`)?.node
    ?.effort
  const parsed = SessionSettingsSchema.safeParse({ effort })
  return parsed.success && parsed.data.effort ? { effort: parsed.data.effort } : {}
}
