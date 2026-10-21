import { mountKit } from '@/components/obsidian/mount'
import { ensureNodeAgents } from './nodeAgentTools'

/** Opens the owner's exact node/provider agent, without changing its mode. */
export async function openNodeAgentSettings(
  nodeId: string,
  name: string,
  provider: string,
  nodePermissionReason?: string
): Promise<void> {
  const { default: AgentEditorModal } = await import(
    '@/components/settings/ai/AgentEditorModal.vue'
  )
  const agent = ensureNodeAgents(nodeId, name, [provider])[0]
  if (!agent) return
  const host = document.body.createDiv()
  const modal = mountKit(
    host,
    AgentEditorModal,
    {
      agentId: agent.id,
      nodePermissionReason,
      onClose: () => modal.unmount(),
    },
    { remove: true }
  )
}
