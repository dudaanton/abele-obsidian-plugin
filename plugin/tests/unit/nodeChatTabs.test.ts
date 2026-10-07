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

it('hydrates large normalized output through artifact reads without appending final snapshots twice', async () => {
  const store = new MemoryClientStore()
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    store
  )
  await store.transaction((s) => {
    s.events['sample-session'] = [
      {
        kind: 'event',
        node_id: 'sample-node',
        stream_id: 'sample-session',
        seq: 1,
        at: '2025-01-01T00:00:00.000Z',
        actor: { kind: 'node' },
        type: 'claude.message.final',
        data: { run_id: 'r', artifact_id: 'a', size: 9000 },
      },
    ]
  })
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  const data = {
    message_id: 'm',
    role: 'assistant',
    content: [{ type: 'text', text: 'Large **answer**' }],
  }
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  vi.spyOn(client, 'request').mockResolvedValue({
    offset: 0,
    total: bytes.length,
    base64: btoa(String.fromCharCode(...bytes)),
  })
  const presenter = new NodeChatPresenter(reference, {
    client,
    state: ref('connected'),
  } as unknown as NodeConnection)
  await presenter.refresh()
  await presenter.refresh()
  expect(presenter.messages.value.map((m) => m.content)).toEqual(['Large **answer**'])
  expect(client.request).toHaveBeenCalledOnce()
  vi.spyOn(client, 'connected', 'get').mockReturnValue(false)
  const restored = new NodeChatPresenter(reference, {
    client,
    state: ref('offline'),
  } as unknown as NodeConnection)
  await restored.refresh()
  expect(restored.messages.value.map((m) => m.content)).toEqual(['Large **answer**'])
  presenter.destroy()
  restored.destroy()
})

async function normalizedArtifact() {
  const store = new MemoryClientStore()
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    store
  )
  await store.transaction((s) => {
    s.events[reference.sessionId] = [
      {
        kind: 'event',
        node_id: reference.nodeId,
        stream_id: reference.sessionId,
        seq: 1,
        at: '2025-01-01T00:00:00.000Z',
        actor: { kind: 'node' },
        type: 'claude.message.final',
        data: { run_id: 'run', artifact_id: 'artifact', size: 9000 },
      },
    ]
  })
  const connected = vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  const state = ref('connected')
  vi.spyOn(client, 'subscribe').mockResolvedValue({})
  const response = (text: string) => {
    const bytes = new TextEncoder().encode(text)
    return { offset: 0, total: bytes.length, base64: btoa(String.fromCharCode(...bytes)) }
  }
  const valid = response(
    JSON.stringify({
      message_id: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Recovered answer' }],
    })
  )
  const request = vi.spyOn(client, 'request').mockResolvedValue(valid)
  const presenter = new NodeChatPresenter(reference, { client, state } as unknown as NodeConnection)
  return { store, client, presenter, state, connected, request, response, valid }
}

it.each(['disconnected', 'request timeout'])(
  'retries transient artifact reads on refresh (%s)',
  async (error) => {
    const f = await normalizedArtifact()
    try {
      f.request.mockRejectedValueOnce(new Error(error))
      await f.presenter.refresh()
      expect(f.presenter.messages.value).toEqual([])
      await f.presenter.refresh()
      expect(f.presenter.messages.value.map((m) => m.content)).toEqual(['Recovered answer'])
      expect(f.request).toHaveBeenCalledTimes(2)
    } finally {
      f.presenter.destroy()
    }
  }
)

it('excludes invalid artifact encodings from automatic retry', async () => {
  const f = await normalizedArtifact()
  try {
    f.request.mockResolvedValue({ offset: 0, total: 2, base64: '%%%' })
    await f.presenter.refresh()
    await f.presenter.refresh()
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.presenter.messages.value).toEqual([])
  } finally {
    f.presenter.destroy()
  }
})

it('retries a failed payload cache commit rather than treating it as unusable content', async () => {
  const f = await normalizedArtifact()
  try {
    f.request.mockImplementationOnce(async () => {
      f.store.fault = () => {
        f.store.fault = undefined
        throw new Error('Sample storage failure')
      }
      return f.valid
    })
    await f.presenter.refresh()
    expect(f.presenter.messages.value).toEqual([])
    await f.presenter.refresh()
    expect(f.presenter.messages.value.map((m) => m.content)).toEqual(['Recovered answer'])
    expect(f.request).toHaveBeenCalledTimes(2)
  } finally {
    f.presenter.destroy()
  }
})

it('retries a disconnected artifact when the connection returns', async () => {
  const f = await normalizedArtifact()
  try {
    f.request.mockRejectedValueOnce(new Error('disconnected'))
    await f.presenter.refresh()
    f.connected.mockReturnValue(false)
    f.state.value = 'offline'
    await f.presenter.refresh()
    f.connected.mockReturnValue(true)
    f.state.value = 'connected'
    await vi.waitFor(() =>
      expect(f.presenter.messages.value.map((m) => m.content)).toEqual(['Recovered answer'])
    )
    expect(f.request).toHaveBeenCalledTimes(2)
  } finally {
    f.presenter.destroy()
  }
})

it('excludes unusable payloads from automatic retry, but a successful manual read repairs the cached projection', async () => {
  const f = await normalizedArtifact()
  try {
    f.request.mockResolvedValue(f.response('{invalid json'))
    await f.presenter.refresh()
    await f.presenter.refresh()
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.presenter.messages.value).toEqual([])
    f.request.mockResolvedValue(f.valid)
    await f.presenter.artifact('artifact')
    expect(f.presenter.error.value).toBe('')
    expect(f.presenter.messages.value.map((m) => m.content)).toEqual(['Recovered answer'])
    await f.presenter.refresh()
    expect(f.request).toHaveBeenCalledTimes(2)
  } finally {
    f.presenter.destroy()
  }
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
