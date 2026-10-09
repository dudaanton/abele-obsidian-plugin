import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { TFile } from 'obsidian'
import type { NodeClient, DelegationStatus } from '@abele/node-client'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { serializeChat } from '@/ai/ChatLog'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { Message } from '@/ai/client'
import { NodeService, NodeConnection } from '@/node/NodeService'
import { NodeClientStore } from '@/node/NodeClientStore'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

let session: ChatSession
let connection: NodeConnection
let store: NodeClientStore
let factory: IDBFactory
let parent: string
let status: DelegationStatus
let client: { connected: boolean; delegationStatus: ReturnType<typeof vi.fn>; subscribeDelegation: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }

beforeEach(async () => {
  factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  const app = useVault([{ path: 'Chats/sample-parent.abchat', content: serializeChat({
    metadata: { type: 'abele-chat', created: '2028-01-01' }, messages: [], internalMessages: [],
  }) }])
  ChatStorage.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  session = new ChatSession(ChatService.getInstance())
  await session.load(app.vault.getAbstractFileByPath('Chats/sample-parent.abchat') as TFile)
  parent = await session.ensureDelegationParentId()
  vi.spyOn(ChatService.getInstance(), 'getAllSessions').mockReturnValue([session])
  store = new NodeClientStore('sample-stop', factory)
  const child = {
    node_id: 'node', session_id: 'child', delegation_id: 'delegation', delegation_key: 'key',
    grant_id: 'grant', parent_id: parent, mailbox_stream_id: 'mailbox', workspace_id: null,
    job_id: null, state: 'completed' as const, created_at: '2028-01-01T00:00:00Z',
  }
  status = { ...child, session_head_seq: 17, mailbox_head_seq: 2, pending_human_prompts: 0 }
  await store.transaction((s) => {
    s.delegation = { grants: { grant: {
      grant_id: 'grant', parent_id: parent, installation_id: 'installation', approved_by: 'installation',
      project_ids: ['project'], providers: ['pi'], actions: ['create', 'status', 'read', 'cancel'],
      allow_fake: false, revoked: false, created_at: '2028-01-01T00:00:00Z',
    } }, tasks: { key: {
      parentId: parent,
      input: { task_key: 'key', project_id: 'project', provider: 'pi', title: 'Sample task', text: 'Work', base_ref: 'HEAD' },
      request: { grant_id: 'grant', delegation_key: 'key', project_id: 'project', provider: 'pi', title: 'Sample task', text: 'Work', base_ref: 'HEAD' },
      child, status,
    } } }
  })
  client = { connected: true, delegationStatus: vi.fn(async () => status), subscribeDelegation: vi.fn(async () => {}), disconnect: vi.fn(async () => {}) }
  connection = new NodeConnection(client as unknown as NodeClient, store)
  // Test-owned connection, deliberately not started: no timers or shared Obsidian resources.
  const service = NodeService.getInstance()
  ;(service as unknown as { connections: Map<string, NodeConnection> }).connections.set('sample', connection)
})
afterEach(() => {
  session.destroy()
  NodeService.destroyCurrent()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function deliver() {
  await store.transaction((s) => {
    const envelope = { kind: 'event' as const, node_id: 'node', actor: { kind: 'node' as const }, at: '2028-01-01T00:00:00Z', stream_id: 'mailbox' }
    s.events.mailbox = [
      { ...envelope, seq: 1, type: 'delegation.result', data: { delegation_id: 'delegation', session_id: 'child', report_id: 'report', text: 'Sample durable result' } },
      { ...envelope, seq: 2, type: 'delegation.terminal', data: { delegation_id: 'delegation', session_id: 'child', state: 'completed' } },
    ]
    s.cursors.mailbox = 2
  })
}

it('still wakes an unstopped parent once the durable result is ready', async () => {
  await connection.delegation.status(parent, 'delegation')
  const send = vi.spyOn(session, 'sendMessage').mockResolvedValue(undefined)
  await deliver()
  await connection.refreshDelegations()
  await connection.refreshDelegations()
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][0]).toContain('node_delegation_status')
  expect(await store.transaction((s) => s.delegation!.tasks.key.awaitingResult)).toBe(false)
})

it('clears the durable waiter on Stop; replay stores the result without starting a parent turn', async () => {
  expect((await connection.delegation.status(parent, 'delegation')).state).toBe('receiving mailbox')
  const send = vi.spyOn(session, 'sendMessage').mockResolvedValue(undefined)
  session.abort()
  await deliver()
  await connection.refreshDelegations()
  expect(send).not.toHaveBeenCalled()
  expect(await store.transaction((s) => s.delegation!.tasks.key.awaitingResult)).toBe(false)
  expect(connection.delegationCards.value[parent][0].reports).toMatchObject([{ kind: 'result', text: 'Sample durable result' }])
  const reopened = new NodeClientStore('sample-stop', factory)
  const recovery = new NodeConnection(client as unknown as NodeClient, reopened)
  const wake = vi.fn(() => true)
  await recovery.delegation.wakeDelivered(await recovery.delegation.snapshot(), wake)
  expect(wake).not.toHaveBeenCalled()
  reopened.close()
})

it('does not re-arm a waiter when an in-flight status finishes after Stop', async () => {
  const reply = deferred<DelegationStatus>()
  client.delegationStatus.mockImplementationOnce(() => reply.promise)
  const reading = connection.delegation.status(parent, 'delegation')
  await vi.waitFor(() => expect(client.delegationStatus).toHaveBeenCalled())
  session.abort()
  reply.resolve(status)
  await reading
  expect(await store.transaction((s) => s.delegation!.tasks.key.awaitingResult)).toBe(false)
  const send = vi.spyOn(session, 'sendMessage').mockResolvedValue(undefined)
  await deliver()
  await connection.refreshDelegations()
  expect(send).not.toHaveBeenCalled()
})

it('a new explicit turn can arm a new waiter but cannot revive a pre-Stop status request', async () => {
  const reply = deferred<DelegationStatus>()
  client.delegationStatus.mockImplementationOnce(() => reply.promise)
  const reading = connection.delegation.status(parent, 'delegation')
  await vi.waitFor(() => expect(client.delegationStatus).toHaveBeenCalled())
  session.abort()
  const internals = session as unknown as { runAgentLoop: () => Promise<void>; afterTurn: () => Promise<void> }
  vi.spyOn(internals, 'runAgentLoop').mockResolvedValue(undefined)
  vi.spyOn(internals, 'afterTurn').mockResolvedValue(undefined)
  await session.sendMessage('Please continue.')
  reply.resolve(status)
  await reading
  expect(await store.transaction((s) => s.delegation!.tasks.key.awaitingResult)).toBe(false)
  await connection.delegation.status(parent, 'delegation')
  expect(await store.transaction((s) => s.delegation!.tasks.key.awaitingResult)).toBe(true)
})

it('does not start a model turn if Stop arrives during asynchronous wake preparation', async () => {
  await connection.delegation.status(parent, 'delegation')
  await deliver()
  const prepared = deferred<Message>()
  const internals = session as unknown as { userMessage: (text: string) => Promise<Message>; runAgentLoop: () => Promise<void> }
  const userMessage = vi.spyOn(internals, 'userMessage').mockImplementation(() => prepared.promise)
  const loop = vi.spyOn(internals, 'runAgentLoop').mockResolvedValue(undefined)
  const send = vi.spyOn(session, 'sendMessage')
  await connection.refreshDelegations()
  await vi.waitFor(() => expect(userMessage).toHaveBeenCalled())
  session.abort()
  prepared.resolve({ role: 'user', content: 'Sample result notification', timestamp: 1 })
  await send.mock.results[0].value
  expect(loop).not.toHaveBeenCalled()
})

it.each(['drain', 'iteration'] as const)('keeps the queued wake fence during %s preparation after Stop', async (consumer) => {
  await connection.delegation.status(parent, 'delegation')
  session.isStreaming.value = true
  const send = vi.spyOn(session, 'sendMessage')
  await deliver()
  await connection.refreshDelegations()
  await send.mock.results[0].value
  expect(session.queuedMessages.value).toHaveLength(1)
  session.isStreaming.value = false
  const prepared = deferred<Message>()
  const internals = session as unknown as {
    userMessage: (text: string) => Promise<Message>
    runAgentLoop: () => Promise<void>
    afterTurn: () => Promise<void>
    drainQueue: () => Promise<void>
    takeQueued: () => Promise<Message[]>
  }
  const userMessage = vi.spyOn(internals, 'userMessage').mockImplementation(() => prepared.promise)
  const loop = vi.spyOn(internals, 'runAgentLoop').mockResolvedValue(undefined)
  vi.spyOn(internals, 'afterTurn').mockResolvedValue(undefined)
  const consuming = consumer === 'drain' ? internals.drainQueue() : internals.takeQueued()
  await vi.waitFor(() => expect(userMessage).toHaveBeenCalled())
  session.abort()
  prepared.resolve({ role: 'user', content: 'Sample result notification', timestamp: 1 })
  const injected = await consuming
  expect(loop).not.toHaveBeenCalled()
  if (consumer === 'iteration') expect(injected).toEqual([])
  expect(session.queuedMessages.value).toEqual([])
  expect((await connection.delegation.cards(parent))[0].reports).toMatchObject([{ kind: 'result', text: 'Sample durable result' }])
})

it('drains a queued wake normally when no Stop invalidated it', async () => {
  await connection.delegation.status(parent, 'delegation')
  session.isStreaming.value = true
  const send = vi.spyOn(session, 'sendMessage')
  await deliver()
  await connection.refreshDelegations()
  await send.mock.results[0].value
  expect(session.queuedMessages.value).toHaveLength(1)
  expect((await ChatStorage.getInstance().loadChat(session.currentChatFile.value!)).metadata?.queuedMessages?.[0].delegationWake).toMatchObject({
    sessionId: session.id, generation: session.conversationVersion.value, stopEpoch: expect.any(Number),
  })
  session.isStreaming.value = false
  const internals = session as unknown as { runAgentLoop: () => Promise<void>; afterTurn: () => Promise<void>; drainQueue: () => Promise<void> }
  const loop = vi.spyOn(internals, 'runAgentLoop').mockResolvedValue(undefined)
  vi.spyOn(internals, 'afterTurn').mockResolvedValue(undefined)
  await internals.drainQueue()
  expect(loop).toHaveBeenCalledTimes(1)
  expect(session.queuedMessages.value).toEqual([])
})

it.each(['drain', 'iteration'] as const)('drops a stale queued wake on %s even after an explicit resume, without losing user messages', async (consumer) => {
  await connection.delegation.status(parent, 'delegation')
  session.isStreaming.value = true
  const send = vi.spyOn(session, 'sendMessage')
  await deliver()
  await connection.refreshDelegations()
  await send.mock.results[0].value
  const stale = session.queuedMessages.value.slice()
  session.abort()
  session.isStreaming.value = false
  const internals = session as unknown as {
    userMessage: (text: string) => Promise<Message>
    runAgentLoop: () => Promise<void>
    afterTurn: () => Promise<void>
    drainQueue: () => Promise<void>
    takeQueued: () => Promise<Message[]>
  }
  const loop = vi.spyOn(internals, 'runAgentLoop').mockResolvedValue(undefined)
  vi.spyOn(internals, 'afterTurn').mockResolvedValue(undefined)
  await session.sendMessage('Please continue.')
  loop.mockClear()
  // A previously captured queue snapshot must remain stale after the parent resumes.
  session.queuedMessages.value = [...stale, { id: 'explicit-user', content: 'Explicit queued message' }]
  const userMessage = vi.spyOn(internals, 'userMessage')
  const injected = consumer === 'drain' ? await internals.drainQueue() : await internals.takeQueued()
  expect(userMessage).toHaveBeenCalledTimes(1)
  expect(userMessage.mock.calls[0][0]).toBe('Explicit queued message')
  expect(loop).toHaveBeenCalledTimes(consumer === 'drain' ? 1 : 0)
  if (consumer === 'iteration') expect(injected).toMatchObject([{ content: 'Explicit queued message' }])
  expect(session.queuedMessages.value).toEqual([])
})

it('drops a persisted queued wake rather than treating reopening as an explicit resume', async () => {
  await connection.delegation.status(parent, 'delegation')
  session.isStreaming.value = true
  const send = vi.spyOn(session, 'sendMessage')
  await deliver()
  await connection.refreshDelegations()
  await send.mock.results[0].value
  const file = session.currentChatFile.value!
  session.destroy()
  session = new ChatSession(ChatService.getInstance())
  await session.load(file)
  const internals = session as unknown as { userMessage: (text: string) => Promise<Message>; runAgentLoop: () => Promise<void>; afterTurn: () => Promise<void>; drainQueue: () => Promise<void> }
  const userMessage = vi.spyOn(internals, 'userMessage')
  const loop = vi.spyOn(internals, 'runAgentLoop').mockResolvedValue(undefined)
  vi.spyOn(internals, 'afterTurn').mockResolvedValue(undefined)
  await internals.drainQueue()
  expect(userMessage).not.toHaveBeenCalled()
  expect(loop).not.toHaveBeenCalled()
  expect(session.queuedMessages.value).toEqual([])
  expect((await connection.delegation.cards(parent))[0].reports).toHaveLength(1)
})

it('fences a wake callback already selected when Stop wins at the dispatch boundary', async () => {
  await connection.delegation.status(parent, 'delegation')
  await deliver()
  const send = vi.spyOn(session, 'sendMessage').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getAllSessions').mockImplementation(() => {
    session.abort()
    return [session]
  })
  await connection.refreshDelegations()
  expect(send).not.toHaveBeenCalled()
})
