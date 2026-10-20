import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { chatsOf } from '@/chats/chatTree'
import { useVault } from '../helpers/testEnv'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { GlobalStore } from '@/stores/GlobalStore'
import { parseChat } from '@/ai/ChatLog'

let service: ChatService
beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    agents: [],
    chatHistory: [],
  }
  service = ChatService.getInstance()
})
afterEach(() => service.destroy())

it('retains helper runs beneath a closed parent and reopens them through the run service', async () => {
  await service.folders.create('', 'Projects')
  const id = service.createTab()
  const parent = service.getSession(id)!
  await parent.createInDirectory(service.folders.path('Projects'))
  const fixture = parent as unknown as {
    appendChatMessage(message: ChatMessage): void
    updateVisibleMessages(): void
  }
  fixture.appendChatMessage({
    id: 'sample-helper-call',
    role: 'tool-call',
    content: '',
    timestamp: 100,
    toolName: 'delegate',
    subAgentRun: {
      runId: 'sample-run',
      agentId: 'sample-agent',
      agentName: 'Sample helper',
      path: 'AI/Runs/sample.abchat',
      status: 'done',
      branchCount: 1,
    },
  })
  fixture.updateVisibleMessages()
  parent.markDirty()
  const tree = service.tree
  await tree.refresh()
  expect(chatsOf(tree.root.value).find((chat) => chat.id === id)?.children).toContainEqual(
    expect.objectContaining({ id: 'run:sample-run', open: true })
  )
  const file = parent.currentChatFile.value!
  await service.closeTab(id)
  const disk = parseChat(await GlobalStore.getInstance().app.vault.read(file))
  expect(disk.messages.some((message) => message.subAgentRun?.runId === 'sample-run')).toBe(true)
  await tree.refresh()
  expect(
    chatsOf(tree.root.value).find((chat) => chat.id === 'run:sample-run'),
    JSON.stringify(tree.root.value)
  ).toMatchObject({
    open: false,
    nested: 'helper',
  })
  const open = vi.spyOn(service, 'openRun').mockResolvedValue(true)
  tree.open('run:sample-run')
  expect(open).toHaveBeenCalledWith('sample-run')
})

it('retains a closed node reference under its parent in device-local layout', async () => {
  const id = service.createTab()
  const parent = service.getSession(id)!
  await service.folders.create('', 'Projects')
  await parent.createInDirectory(service.folders.path('Projects'))
  const reference = {
    kind: 'node-session' as const,
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    sessionId: 'sample-session',
    title: 'Sample node work',
  }
  const nodeId = 'node:sample-registration:sample-session'
  const node = {
    id: nodeId,
    reference,
    label: ref(reference.title),
    messages: ref([]),
    isStreaming: ref(false),
    provider: ref('fake'),
    projection: ref({ prompts: [] }),
    error: ref(''),
    destroy: vi.fn(),
  } as unknown as NodeChatPresenter
  ;(service as unknown as { nodeSessions: Map<string, NodeChatPresenter> }).nodeSessions.set(
    nodeId,
    node
  )
  service.nodeParentPaths.value = { [nodeId]: parent.currentChatFile.value!.path }
  service.tabOrder.value = [...service.tabOrder.value, nodeId]
  await service.closeTab(nodeId)
  const tree = service.tree
  await tree.refresh()
  expect(chatsOf(tree.root.value).find((chat) => chat.id === id)?.children).toContainEqual(
    expect.objectContaining({ id: nodeId, open: false, nested: 'node' })
  )
  expect(service.closedNodeChats.value[0].reference).toEqual(reference)
  expect(node.destroy).toHaveBeenCalledOnce()
})
