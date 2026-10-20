import { describe, it, expect, beforeEach } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { NODE_AGENT_TOOL_NAMES } from '@/ai/tools/node/agent'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'
import { parseChat, serializeChat } from '@/ai/ChatLog'

destroyChatsAfterEach()
beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
})
describe('chat node file permissions and persistence', () => {
  it('reads delegation status and destinations without asking in every permission mode', () => {
    const session = new ChatSession(ChatService.getInstance())
    for (const mode of ['confirm-all', 'allow-edit', 'allow-all'] as const) {
      session.permissionMode.value = mode
      expect(session.needsApproval('node_delegations')).toBe(false)
      expect(session.needsApproval('node_delegation_status')).toBe(false)
      expect(session.needsApproval('node_git_commit')).toBe(true)
      expect(session.needsApproval('node_worktree_remove')).toBe(true)
    }
    session.destroy()
  })
  it('uses the ordinary edit permission mode, not optional tool Auto modes', () => {
    useVault([])
    const session = new ChatSession(ChatService.getInstance())
    for (const mode of ['confirm-all', 'allow-edit', 'allow-all'] as const) {
      session.permissionMode.value = mode
      for (const name of ['node_edit', 'node_replace', 'node_write'])
        expect(session.needsApproval(name)).toBe(mode === 'confirm-all')
      for (const name of ['node_rm', 'node_mv', 'node_cp'])
        expect(session.needsApproval(name)).toBe(mode !== 'allow-all')
      expect(session.needsApproval('node_propose_edit')).toBe(true)
      expect(session.needsApproval('node_read')).toBe(false)
    }
    session.destroy()
  })
  it('offers the node tools when this chat has node scope, and persists scope and selection as overrides', () => {
    useVault([])
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({ name: 'Sample agent' })
    registry.setDefault(agent.id)
    const session = new ChatSession(ChatService.getInstance())
    const target = {
      node_id: 'sample-node',
      project_id: 'sample-project',
      target: { kind: 'workspace' as const, workspace_id: 'sample-folder' },
    }
    session.overrides.value = {
      nodeScope: [{ kind: 'target', ...target, access: 'edit' }],
      nodeTarget: target,
    }
    const tools = (session as unknown as { getTools(): { name: string }[] }).getTools()
    for (const name of NODE_AGENT_TOOL_NAMES) expect(tools.map((tool) => tool.name)).toContain(name)
    const snapshot = (
      session as unknown as { snapshot(): Parameters<typeof serializeChat>[0] }
    ).snapshot()
    expect(parseChat(serializeChat(snapshot)).metadata?.overrides).toMatchObject(
      session.overrides.value
    )
    session.destroy()
  })
})
