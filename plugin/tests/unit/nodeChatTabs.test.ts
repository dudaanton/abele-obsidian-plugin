import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { ChatService } from '@/ai/ChatService'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { NodeService, type NodeConnection } from '@/node/NodeService'
import { newChatMenu } from '@/node/openSession'
import { useVault } from '../helpers/testEnv'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

const reference = {
  kind: 'node-session' as const,
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  sessionId: 'sample-session',
  title: 'Sample session',
}
afterEach(() => {
  ChatService.getInstance().destroy()
  vi.restoreAllMocks()
})

it('keeps the local new-chat action usable when node preferences cannot be read', () => {
  useVault([])
  vi.spyOn(NodeService, 'getInstance').mockImplementation(() => {
    throw new Error('Sample damaged node preferences')
  })
  const local = vi.fn()
  expect(() => newChatMenu(local, { x: 0, y: 0 })).not.toThrow()
  expect(local).toHaveBeenCalledOnce()
})

it('does not subscribe a presenter closed while connection admission is pending', async () => {
  let release!: () => void
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    new MemoryClientStore()
  )
  const subscribe = vi.spyOn(client, 'subscribe').mockResolvedValue({})
  const connection = {
    client,
    state: ref('offline'),
    connect: () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  } as unknown as NodeConnection
  const presenter = new NodeChatPresenter(reference, connection)
  const loading = presenter.load()
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve()
  presenter.destroy()
  release()
  await loading
  expect(subscribe).not.toHaveBeenCalled()
})

it('keeps the entered text when local persistence fails before enqueueing', async () => {
  const store = new MemoryClientStore()
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    store
  )
  const connection = { client, state: ref('offline') } as unknown as NodeConnection
  const presenter = new NodeChatPresenter(reference, connection)
  vi.spyOn(store, 'transaction').mockRejectedValueOnce(new Error('Sample storage unavailable'))
  await expect(presenter.send('Sample unsent input')).resolves.toBeUndefined()
  expect(presenter.draft.value.text).toBe('Sample unsent input')
  expect(presenter.error.value).toContain('Sample storage unavailable')
  expect(await client.pending()).toHaveLength(0)
  presenter.destroy()
})

it('keeps a terminally rejected input as a draft rather than an accepted message', async () => {
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    new MemoryClientStore()
  )
  const presenter = new NodeChatPresenter(reference, {
    client,
    state: ref('connected'),
  } as unknown as NodeConnection)
  vi.spyOn(client, 'send').mockResolvedValue({ operation_id: 'sample-operation' })
  vi.spyOn(client, 'operationResult').mockResolvedValue({ error: 'not_found' })
  await presenter.send('Sample rejected input')
  expect(presenter.draft.value.text).toBe('Sample rejected input')
  expect(presenter.error.value).toContain('Not accepted')
  expect(presenter.messages.value).toEqual([])
  presenter.destroy()
})

it('restores discriminated node tabs without instantiating local execution or vault chat files', async () => {
  const app = useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  ChatService.getInstance().destroy()
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    new MemoryClientStore()
  )
  const connection = {
    client,
    state: ref('offline'),
    connect: vi.fn().mockRejectedValue(new Error('offline')),
  } as unknown as NodeConnection
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    connection: () => connection,
    destroy: () => {},
  } as unknown as NodeService)
  app.saveLocalStorage('abele-agent-tabs', {
    tabs: [{ kind: 'local-chat', chatFilePath: null }, reference],
    activeIndex: 1,
  })
  const chats = ChatService.getInstance()
  await chats.restoreTabs()
  expect(chats.tabOrder.value).toHaveLength(2)
  const node = chats.getNodeSession(chats.activeTabId.value!)
  expect(node).toBeInstanceOf(NodeChatPresenter)
  expect(node?.reference).toEqual(reference)
  expect(chats.activeSession.value).toBeNull()
  expect(chats.getAllSessions()).toHaveLength(1)
  expect(node?.capabilities).toMatchObject({
    branches: false,
    rewind: false,
    editHistory: false,
    attachments: false,
  })
  chats.saveTabs()
  expect(app.loadLocalStorage('abele-agent-tabs')).toMatchObject({
    tabs: [{ kind: 'local-chat', chatFilePath: null }, reference],
    activeIndex: 1,
  })
  await chats.closeTab(node!.id)
  expect(chats.tabOrder.value).toHaveLength(1)
  expect(chats.activeSession.value).not.toBeNull()
})
