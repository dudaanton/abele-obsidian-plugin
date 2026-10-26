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
import { nodeRepositoryToolsHost } from '@/ai/tools/node'
import type { RepositorySource } from '@/repository/source'
import { addNodeContextToObsidianChat, askNodeContextInObsidianChat } from '@/ai/tools/node/context'

vi.mock('@/node/NodeService', () => {
  const registry = {
    authorizationId: () => 'sample-authority',
    list: () => [
      {
        id: 'sample-registration',
        expectedNodeId: 'sample-node',
        label: 'Sample node',
        url: 'http://127.0.0.1:1',
      },
    ],
  }
  const client = { connected: true }
  const service = {
    registry,
    nodes: { value: registry.list() },
    connection: () => ({ client, authorizationGeneration: 0 }),
  }
  return {
    NodeService: {
      getInstance: () => service,
      destroyCurrent: () => {},
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
  it('keeps shared Run access and Delegate permission after saving, reopening and copying a chat', async () => {
    const session = new ChatSession(ChatService.getInstance())
    session.toolModes.value = { ...session.toolModes.value, delegate: 'ask' }
    await giveObsidianChatAccess(session, { kind: 'node', node_id: 'sample-node', access: 'run' })
    expect(session.getToolMode('node_delegate')).toBe('ask')
    const file = session.currentChatFile.value!
    const { GlobalStore } = await import('@/stores/GlobalStore')
    const app = GlobalStore.getInstance().app
    const copied = await app.vault.create('sample-copy.abchat', await app.vault.read(file))
    const reopened = new ChatSession(ChatService.getInstance())
    await reopened.load(file)
    expect(reopened.getToolMode('node_delegate')).toBe('ask')
    const clone = new ChatSession(ChatService.getInstance())
    await clone.load(copied)
    expect(clone.getToolMode('node_delegate')).toBe('ask')
    session.destroy()
    reopened.destroy()
    clone.destroy()
  })
  it('restores an empty scoped chat from its saved tab reference after service restart', async () => {
    const service = ChatService.getInstance()
    const id = (await service.newTab())!
    const session = service.getSession(id)!
    const entry = { kind: 'node' as const, node_id: 'sample-node', access: 'read' as const }
    await giveObsidianChatAccess(session, entry)
    const path = session.currentChatFile.value!.path
    service.destroy()
    const restored = ChatService.getInstance()
    await restored.restoreTabs()
    const chat = restored.getAllSessions().find((chat) => chat.currentChatFile.value?.path === path)
    expect(chat?.overrides.value.nodeScope).toEqual([entry])
  })
  it('saves shared access even for an empty chat without a device approval identity', async () => {
    const session = new ChatSession(ChatService.getInstance())
    const entry = { kind: 'node' as const, node_id: 'sample-node', access: 'edit' as const }
    await giveObsidianChatAccess(session, entry)
    expect(session.nodeScopeIdentity).toBeUndefined()
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
      lines: { start: 4, end: 5 },
    }
    const addition = addNodeContextToObsidianChat(session, reference, 'Selected sample bytes')
    reference.path = 'changed-selection.txt'
    await addition
    expect(session.draft.value.text).toContain('Sample draft')
    // Context is readable in the composer; opaque routing metadata must stay out of it.
    expect(session.draft.value.text).toContain('sample.txt:4-5\n\n> Selected sample bytes')
    expect(session.draft.value.text).not.toContain('sample-node')
    expect(session.draft.value.text).not.toContain('node_context')
    expect(session.draft.value.text).not.toContain('content_id')
    expect(session.draft.value.text).not.toContain('changed-selection.txt')
    expect(session.overrides.value.nodeScope).toBeUndefined()
    expect(session.isStreaming.value).toBe(false)
    await askNodeContextInObsidianChat(
      session,
      { ...reference, path: 'sample.txt' },
      'Sample question context'
    )
    expect(session.draft.value.text).toContain('> Sample question context')
    expect(session.draft.value.text).not.toContain('node_context')
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
  it('adding one entry preserves existing shared entries on the same node', async () => {
    const session = new ChatSession(ChatService.getInstance())
    const imported = {
      kind: 'project' as const,
      node_id: 'sample-node',
      project_id: 'imported-project',
      access: 'edit' as const,
    }
    session.overrides.value = { nodeScope: [imported] }
    await giveObsidianChatAccess(session, { ...imported, project_id: 'chosen-project' })
    const host = await nodeAgentHost(),
      principal = host.connection('sample-node').principal()
    expect(() =>
      host.ledger.guard(
        session,
        {
          node_id: 'sample-node',
          project_id: 'chosen-project',
          target: { kind: 'worktree', worktree_id: 'chosen-tree' },
        },
        principal,
        'edit'
      )
    ).not.toThrow()
    expect(() =>
      host.ledger.guard(
        session,
        {
          node_id: 'sample-node',
          project_id: 'imported-project',
          target: { kind: 'worktree', worktree_id: 'imported-tree' },
        },
        principal,
        'edit'
      )
    ).not.toThrow()
    session.destroy()
  })
  it('removing one shared entry preserves the remaining shared scope', async () => {
    const session = new ChatSession(ChatService.getInstance())
    const first = {
      kind: 'project' as const,
      node_id: 'sample-node',
      project_id: 'first-project',
      access: 'edit' as const,
    }
    session.overrides.value = { nodeScope: [first, { ...first, project_id: 'remaining-project' }] }
    await removeObsidianChatNodeAccess(session, first)
    const host = await nodeAgentHost(),
      principal = host.connection('sample-node').principal()
    expect(host.ledger.approvedNode(session, 'sample-node', principal)).toBe(true)
    session.destroy()
  })
  it('removing a different entry preserves only already approved surviving entries', async () => {
    const session = new ChatSession(ChatService.getInstance())
    const chosen = {
      kind: 'project' as const,
      node_id: 'sample-node',
      project_id: 'chosen-project',
      access: 'edit' as const,
    }
    await giveObsidianChatAccess(session, chosen)
    const imported = { ...chosen, project_id: 'imported-project' }
    session.overrides.value = { ...session.overrides.value, nodeScope: [chosen, imported] }
    await removeObsidianChatNodeAccess(session, imported)
    const host = await nodeAgentHost(),
      principal = host.connection('sample-node').principal()
    expect(() =>
      host.ledger.guard(
        session,
        {
          node_id: 'sample-node',
          project_id: 'chosen-project',
          target: { kind: 'worktree', worktree_id: 'chosen-tree' },
        },
        principal,
        'edit'
      )
    ).not.toThrow()
    session.destroy()
  })
  it('configured scope edits synchronously delete the legacy read grants', () => {
    const session = new ChatSession(ChatService.getInstance())
    const tab = {
      source: {
        identity: {
          provider: 'node',
          node: 'sample-registration',
          project: 'other-project',
          workspace: 'other-tree',
          installation: 'sample-installation',
        },
        cacheNamespace: 'sample-source',
        assertCurrent: () => {},
      } as RepositorySource,
      selection: () => null,
      open: () => {},
    }
    const detach = nodeRepositoryToolsHost.attach(tab)
    nodeRepositoryToolsHost.grant(session, 'sample-registration', 'other-project')
    expect(nodeRepositoryToolsHost.authorized(session, tab)).toBe(true)
    session.overrides.value.nodeScope = []
    expect(nodeRepositoryToolsHost.authorized(session, tab)).toBe(false)
    session.overrides.value = {}
    expect(nodeRepositoryToolsHost.authorized(session, tab)).toBe(false)
    detach()
    session.destroy()
  })
  it('the repository revoke action fences pending reads without clearing shared node scope', async () => {
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
    expect(host.ledger.approvedNode(session, 'sample-node', principal)).toBe(true)
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
    expect(host.ledger.approvedNode(session, 'sample-node', principal)).toBe(true)
    session.destroy()
  })
})
