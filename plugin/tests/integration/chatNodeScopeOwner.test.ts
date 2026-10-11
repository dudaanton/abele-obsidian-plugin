import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AiChatSettings from '@/components/AiChatSettings.vue'
import Button from '@/components/obsidian/Button.vue'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import {
  giveObsidianChatAccess,
  removeObsidianChatNodeAccess,
  nodeAgentHost,
} from '@/ai/tools/node/owner'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'
import { parseChat } from '@/ai/ChatLog'
import { addNodeContextToObsidianChat, askNodeContextInObsidianChat } from '@/ai/tools/node/context'

vi.mock('@/node/NodeService', () => {
  const registry = {
    list: () => [
      {
        id: 'sample-registration',
        expectedNodeId: 'sample-node',
        label: 'Sample node',
        url: 'http://127.0.0.1:1',
      },
    ],
  }
  const service = {
    registry,
    nodes: { value: registry.list() },
    connection: () => ({ client: { connected: true }, authorizationGeneration: 0 }),
  }
  return {
    NodeService: {
      getInstance: () => service,
      stopDelegationWaiters: async () => {},
      resumeDelegationWaiters: () => {},
    },
  }
})

destroyChatsAfterEach()
beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Sample agent' })
  registry.setDefault(agent.id)
})

describe('owner node scope actions', () => {
  it('saves even an empty chat before binding local owner approval to its durable identity', async () => {
    const session = new ChatSession(ChatService.getInstance())
    const entry = { kind: 'node' as const, node_id: 'sample-node', access: 'edit' as const }
    await giveObsidianChatAccess(session, entry)
    expect(session.nodeScopeIdentity).toBeTruthy()
    const host = await nodeAgentHost()
    expect(
      host.ledger.approvedNode(session, 'sample-node', host.connection('sample-node').principal())
    ).toBe(true)
    expect(session.currentChatFile.value).toBeTruthy()
    const { GlobalStore } = await import('@/stores/GlobalStore')
    const saved = await GlobalStore.getInstance().app.vault.read(session.currentChatFile.value!)
    expect(parseChat(saved).metadata?.overrides?.nodeScope).toEqual([entry])
    session.destroy()
  })
  it('adds an immutable displayed snapshot to the chosen draft without granting access or sending it', async () => {
    const session = new ChatSession(ChatService.getInstance())
    session.draft.value = { text: 'Sample draft', attachments: [] }
    const reference = {
      node_id: 'sample-registration',
      project_id: 'sample-project',
      target: { kind: 'worktree' as const, worktree_id: 'sample-tree' },
      path: 'sample.txt',
      content_id: 'a'.repeat(64),
    }
    const addition = addNodeContextToObsidianChat(session, reference, 'Selected sample bytes')
    reference.path = 'changed-selection.txt'
    await addition
    expect(session.draft.value.text).toContain('Sample draft')
    expect(session.draft.value.text).toContain('sample-node')
    expect(session.draft.value.text).toContain('sample.txt')
    expect(session.draft.value.text).not.toContain('changed-selection.txt')
    expect(session.overrides.value.nodeScope).toBeUndefined()
    expect(session.isStreaming.value).toBe(false)
    await askNodeContextInObsidianChat(
      session,
      { ...reference, path: 'sample.txt' },
      'Sample question context'
    )
    expect(ChatService.getInstance().pendingInput.value).toMatchObject({
      tabId: session.id,
      focus: true,
      append: true,
    })
    session.destroy()
  })
  it('persists stable node IDs and replaces an edit entry when the owner narrows it to read', async () => {
    const session = new ChatSession(ChatService.getInstance())
    await giveObsidianChatAccess(session, {
      kind: 'node',
      node_id: 'sample-registration',
      access: 'edit',
    })
    expect(session.overrides.value.nodeScope).toEqual([
      { kind: 'node', node_id: 'sample-node', access: 'edit' },
    ])
    await giveObsidianChatAccess(session, {
      kind: 'node',
      node_id: 'sample-registration',
      access: 'read',
    })
    expect(session.overrides.value.nodeScope).toEqual([
      { kind: 'node', node_id: 'sample-node', access: 'read' },
    ])
    session.destroy()
  })
  it('the existing repository revoke action also revokes persisted node scope approvals', async () => {
    const session = new ChatSession(ChatService.getInstance())
    await giveObsidianChatAccess(session, { kind: 'node', node_id: 'sample-node', access: 'read' })
    vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
      value: session,
    } as never)
    const host = await nodeAgentHost(),
      principal = host.connection('sample-node').principal()
    const check = host.ledger.guardNode(session, 'sample-node', principal)
    const view = mount(AiChatSettings)
    view
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Revoke repository access')!
      .vm.$emit('click')
    expect(check).toThrow()
    await flushPromises()
    expect(host.ledger.approvedNode(session, 'sample-node', principal)).toBe(false)
    view.unmount()
    vi.restoreAllMocks()
    session.destroy()
  })
  it('revokes in-flight reads synchronously on header removal or a configured-scope edit', async () => {
    const session = new ChatSession(ChatService.getInstance())
    const entry = { kind: 'node' as const, node_id: 'sample-node', access: 'read' as const }
    await giveObsidianChatAccess(session, entry)
    const host = await nodeAgentHost(),
      principal = host.connection('sample-node').principal()
    const guard = host.ledger.guardNode(session, 'sample-node', principal)
    const removal = removeObsidianChatNodeAccess(session, entry)
    expect(guard).toThrow()
    await removal
    expect(session.overrides.value.nodeScope).toEqual([])
    await giveObsidianChatAccess(session, entry)
    const current = host.ledger.guardNode(session, 'sample-node', principal)
    session.overrides.value = { ...session.overrides.value, nodeScope: [] }
    session.overrides.value = { ...session.overrides.value, nodeScope: [entry] }
    expect(current).toThrow()
    expect(host.ledger.approvedNode(session, 'sample-node', principal)).toBe(false)
    session.destroy()
  })
})
