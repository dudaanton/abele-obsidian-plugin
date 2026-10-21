import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import { createChatMessagingTools } from '@/ai/tools/ChatMessagingTools'
import { createAgentTools, getToolRegistry, codeToolDescriptions } from '@/ai/tools'
import {
  chatMessaging,
  openMessagingChats,
  openLetterChat,
  canOpenLetterChat,
} from '@/ai/chatMessaging'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'
import type { Message } from '@/ai/client'
import { migrateAgents } from '@/ai/agents/migration'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { ref } from 'vue'
import type { NodeClientState } from '@/node/NodeClientStore'

function nodeLetterTarget() {
  const state: NodeClientState = { events: { sample: [] }, cursors: {}, results: {}, outbox: [] }
  const projection = ref({
    activeRuns: [] as string[],
    queuedInputs: [],
    prompts: [],
    messages: [] as { role: string; nodeTurnId: string; content: string }[],
  })
  const client = {
    connected: true,
    onEvent: () => () => {},
    cursor: async () => 0,
    getSession: vi.fn(async () => ({ session_id: 'sample' })),
    request: vi.fn(async (_method: string, _params: unknown): Promise<unknown> => []),
    store: { transaction: async (fn: (s: NodeClientState) => unknown) => fn(state) },
    flush: vi.fn(async () => {
      const entry = state.outbox.shift()!
      state.results[entry.operation_id] = { result: { input_id: 'sample-input', accepted_seq: 1 } }
    }),
    operationResult: async (id: string) => state.results[id],
  }
  const presenter = Object.create(NodeChatPresenter.prototype) as NodeChatPresenter
  Object.assign(presenter, {
    reference: { sessionId: 'sample' },
    connection: { client, state: ref('connected') },
    projection,
    queued: ref([]),
    messages: ref(projection.value.messages),
    nodeDescription: ref(undefined),
    binding: ref(null),
    refresh: vi.fn(async () => {}),
  })
  const finish = (inputs = ['sample-input']) => {
    projection.value.messages.push(
      { role: 'assistant', nodeTurnId: 'other-turn', content: 'Unrelated answer' },
      { role: 'assistant', nodeTurnId: 'sample-turn', content: 'Only this answer' }
    )
    state.events.sample.push({
      type: 'turn.completed',
      data: { input_ids: inputs, turn_id: 'sample-turn', outcome: 'success' },
    } as never)
  }
  return { state, client, presenter, finish, projection }
}

it('sends sender metadata and resolves the final reply by input id on capable nodes', async () => {
  const { presenter, state } = nodeLetterTarget()
  presenter.nodeDescription.value = { supported_capabilities: ['session_letters_v1'] } as never
  const result = presenter.receiveChatLetter('Sample question', {
    id: 'sender',
    title: 'Sample sender',
  })
  await vi.waitFor(() => expect(Object.keys(state.results)).toHaveLength(1))
  expect(Object.values(state.operationRequests!)[0].params).toMatchObject({
    sender: { id: 'sender', title: 'Sample sender' },
  })
  state.events.sample.push(
    ...([
      {
        seq: 3,
        type: 'session.update',
        data: {
          turn_id: 'letter-turn',
          update: { kind: 'agent_message', message_id: 'final', text: 'Exact final answer' },
        },
      },
      {
        seq: 4,
        type: 'input.reply',
        data: {
          input_id: 'sample-input',
          turn_id: 'letter-turn',
          outcome: 'success',
          final_reply: { message_id: 'final', event_seqs: [3] },
        },
      },
    ] as never[])
  )
  await expect(result).resolves.toBe('Exact final answer')
})

it.each(['failed', 'interrupted', 'empty'])(
  'does not return partial node letter output for %s replies',
  async (outcome) => {
    const { presenter, state, finish } = nodeLetterTarget()
    presenter.nodeDescription.value = { supported_capabilities: ['session_letters_v1'] } as never
    const result = presenter.receiveChatLetter('Sample question', {
      id: 'sender',
      title: 'Sample sender',
    })
    const rejected = expect(result).rejects.toThrow(
      outcome === 'empty' ? 'without an answer' : 'separate answer'
    )
    await vi.waitFor(() => expect(Object.keys(state.results)).toHaveLength(1))
    finish()
    state.events.sample.push({
      type: 'input.reply',
      data: {
        input_id: 'sample-input',
        turn_id: 'sample-turn',
        outcome: outcome === 'empty' ? 'success' : outcome,
        final_reply: null,
      },
    } as never)
    await rejected
    expect(Object.values(state.nodeLetters!)[0].status).toBe('interrupted')
  }
)

it.each([false, true])(
  'reads a referenced final block outside the retained window; artifact: %s',
  async (artifact) => {
    const { presenter, state, client } = nodeLetterTarget()
    presenter.nodeDescription.value = { supported_capabilities: ['session_letters_v1'] } as never
    client.request.mockImplementation(async (method, params) => {
      if (method === 'artifact.read') return { offset: 0, total: 12, base64: btoa('Final answer') }
      expect(params).toEqual({ stream_id: 'sample', after_seq: 2, limit: 1 })
      return [
        {
          kind: 'event',
          node_id: 'sample',
          stream_id: 'sample',
          seq: 3,
          actor: { kind: 'node' },
          at: new Date(0).toISOString(),
          type: artifact ? 'content.delta' : 'session.update',
          data: artifact
            ? { run_id: 'run', artifact_id: 'sample-artifact' }
            : {
                turn_id: 'turn',
                update: { kind: 'agent_message', message_id: 'final', text: 'Final answer' },
              },
        },
      ]
    })
    const result = presenter.receiveChatLetter('Sample question', {
      id: 'sender',
      title: 'Sample sender',
    })
    await vi.waitFor(() => expect(Object.keys(state.results)).toHaveLength(1))
    state.events.sample.push({
      type: 'input.reply',
      data: {
        input_id: 'sample-input',
        turn_id: 'turn',
        run_id: 'run',
        outcome: 'success',
        final_reply: { message_id: 'final', event_seqs: [3] },
      },
    } as never)
    await expect(result).resolves.toBe('Final answer')
  }
)

it('returns only the node turn that consumed the admitted input and persists provenance', async () => {
  const { presenter, state, finish } = nodeLetterTarget()
  const result = presenter.receiveChatLetter('Sample question', {
    id: 'sender',
    title: 'Sample sender',
    path: 'Chats/sample.md',
  })
  await vi.waitFor(() => expect(Object.keys(state.results)).toHaveLength(1))
  finish()
  await expect(result).resolves.toBe('Only this answer')
  expect(Object.values(state.nodeLetters!)).toEqual([
    expect.objectContaining({
      inputId: 'sample-input',
      turnId: 'sample-turn',
      status: 'completed',
      from: expect.objectContaining({ id: 'sender' }),
    }),
  ])
  expect(state.outbox).toEqual([])
})

it('refuses a combined node turn rather than returning another request answer', async () => {
  const { presenter, state, finish } = nodeLetterTarget()
  const result = presenter.receiveChatLetter('Sample question', {
    id: 'sender',
    title: 'Sample sender',
  })
  const refused = expect(result).rejects.toThrow('separate answer')
  await vi.waitFor(() => expect(Object.keys(state.results)).toHaveLength(1))
  finish(['sample-input', 'other-input'])
  await refused
  expect(Object.values(state.nodeLetters!)[0].status).toBe('interrupted')
})

it('refreshes incoming node provenance before waiting for the final answer', async () => {
  const { presenter, state, finish } = nodeLetterTarget()
  const result = presenter.receiveChatLetter('Sample question', {
    id: 'sender',
    title: 'Sample sender',
  })
  try {
    await vi.waitFor(() =>
      expect(Object.values(state.nodeLetters!)[0]?.inputId).toBe('sample-input')
    )
    expect(presenter.refresh).toHaveBeenCalledTimes(2)
  } finally {
    finish()
    await result
  }
})

it('does not substitute intermediate text for an empty final node answer', async () => {
  const { presenter, state, finish, projection } = nodeLetterTarget()
  const result = presenter.receiveChatLetter('Sample question', {
    id: 'sender',
    title: 'Sample sender',
  })
  const refused = expect(result).rejects.toThrow('without an answer')
  await vi.waitFor(() => expect(Object.keys(state.results)).toHaveLength(1))
  finish()
  projection.value.messages.push({ role: 'assistant', nodeTurnId: 'sample-turn', content: '' })
  await refused
})

it('queues behind node work and stops without admission when disconnected', async () => {
  const { presenter, client, projection, state } = nodeLetterTarget()
  projection.value.activeRuns.push('busy-run')
  const result = presenter.receiveChatLetter('Sample question', {
    id: 'sender',
    title: 'Sample sender',
  })
  const refused = expect(result).rejects.toThrow('disconnected')
  await new Promise((resolve) => setTimeout(resolve, 120))
  expect(client.flush).not.toHaveBeenCalled()
  client.connected = false
  await refused
  expect(state.outbox).toEqual([])
})

it('admits a queued node letter once the target finishes its current turn', async () => {
  const { presenter, client, projection, state, finish } = nodeLetterTarget()
  projection.value.activeRuns.push('busy-run')
  const result = presenter.receiveChatLetter('Sample question', {
    id: 'sender',
    title: 'Sample sender',
  })
  await new Promise((resolve) => setTimeout(resolve, 120))
  expect(client.flush).not.toHaveBeenCalled()
  projection.value.activeRuns.length = 0
  await vi.waitFor(() => expect(Object.keys(state.results)).toHaveLength(1))
  finish()
  await expect(result).resolves.toBe('Only this answer')
  expect(client.flush).toHaveBeenCalledTimes(1)
})

it('drops an uncertain letter outbox entry on disconnect without replaying other work', async () => {
  const { presenter, client, state } = nodeLetterTarget()
  let release!: () => void
  client.flush.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const result = presenter.receiveChatLetter('Sample question', {
    id: 'sender',
    title: 'Sample sender',
  })
  const refused = expect(result).rejects.toThrow('disconnected')
  await vi.waitFor(() => expect(state.outbox).toHaveLength(1))
  state.outbox.push({
    operation_id: 'other-operation',
    method: 'session.stop',
    params: { session_id: 'other' },
  })
  client.connected = false
  await refused
  release()
  expect(state.outbox.map((entry) => entry.operation_id)).toEqual(['other-operation'])
  expect(Object.values(state.nodeLetters!)[0].status).toBe('interrupted')
  expect(client.flush).toHaveBeenCalledTimes(1)
})

it('refuses a missing node session before admission', async () => {
  const { presenter, client, state } = nodeLetterTarget()
  client.getSession.mockRejectedValueOnce(new Error('session_not_found'))
  await expect(
    presenter.receiveChatLetter('Sample question', { id: 'sender', title: 'Sample sender' })
  ).rejects.toThrow('check its session')
  expect(client.flush).not.toHaveBeenCalled()
  expect(state.outbox).toEqual([])
})

it('waits for a node turn still in the ordinary send outbox', async () => {
  const { presenter, client, state } = nodeLetterTarget()
  presenter.queued.value.push({ id: 'ordinary-send', text: 'Earlier question' })
  const result = presenter.receiveChatLetter('Sample question', {
    id: 'sender',
    title: 'Sample sender',
  })
  const refused = expect(result).rejects.toThrow('disconnected')
  try {
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(client.flush).not.toHaveBeenCalled()
  } finally {
    client.connected = false
    await refused
  }
  expect(state.outbox).toEqual([])
})

vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(_model: unknown, _system: string, messages: Message[]) {
      if (
        messages.some(
          (m) =>
            m.role === 'user' &&
            typeof m.content === 'string' &&
            m.content.includes('Change the sample')
        ) &&
        !messages.some((m) => m.role === 'toolResult' && m.toolCallId === 'target-write')
      ) {
        yield {
          type: 'done',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'target-write',
                name: 'write',
                arguments: { path: 'sample.txt', content: 'Changed' },
              },
            ],
            stopReason: 'toolUse',
            timestamp: Date.now(),
          },
        }
        return
      }
      yield { type: 'text_delta', delta: 'A sample answer' }
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'A sample answer' }],
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      }
    }
  },
}))

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'key',
  models: [
    { id: 'model', name: 'Model', contextWindow: 1000, maxTokens: 100, supportsReasoning: false },
  ],
}
destroyChatsAfterEach()
beforeEach(() => {
  useVault([{ path: 'sample.txt', content: 'Original sample' }])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  const registry = AgentRegistry.getInstance()
  registry.setDefault(registry.create({ name: 'Helper', providerId: 'p1', modelId: 'model' }).id)
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

it('delivers a node destination through its presenter and returns only that answer', async () => {
  const service = ChatService.getInstance()
  const caller = service.getSession(service.createTab())!
  const receiveChatLetter = vi.fn(async () => 'Sample node answer')
  const node = { receiveChatLetter }
  vi.spyOn(service, 'getNodeSession').mockImplementation((id) =>
    id === 'sample-node' ? (node as never) : null
  )
  vi.spyOn(service, 'listOpenChats').mockReturnValue([
    { id: caller.id, title: 'Sample sender', folder: '', agent: null, state: 'working' },
    { id: 'sample-node', title: 'Sample node', folder: '', agent: null, state: 'idle' },
  ])
  await expect(chatMessaging.send(caller.id, 'sample-node', 'Sample question')).resolves.toBe(
    'Sample node answer'
  )
  expect(receiveChatLetter).toHaveBeenCalledWith(
    'Sample question',
    expect.objectContaining({ id: caller.id, title: 'Sample sender' }),
    undefined
  )
})

it('distinguishes a closed destination from an unknown one and retains its reopen path', async () => {
  const service = ChatService.getInstance()
  const caller = service.getSession(service.createTab())!
  const target = service.getSession(service.createTab())!
  target.chatTitle.value = 'Sample reference'
  await target.addUserNote('Sample context')
  const path = target.currentChatFile.value!.path
  openMessagingChats()
  await service.closeTab(target.id)
  const attach = vi.spyOn(caller, 'attachChatLetter')
  const send = createChatMessagingTools(caller).find(
    (tool) => tool.name === 'send_message_to_chat'
  )!
  await expect(
    send.execute('closed', { chat_id: target.id, message: 'Sample question' })
  ).rejects.toThrow('Sample reference is closed. Open it from the chat tree first.')
  const closed = attach.mock.calls.at(-1)![1]
  expect(closed.to).toMatchObject({ title: 'Sample reference', path })
  expect(canOpenLetterChat(closed.to)).toBe(true)
  await expect(
    send.execute('unknown', { chat_id: 'missing-chat', message: 'Sample question' })
  ).rejects.toThrow('No chat by that name.')
  const unknown = attach.mock.calls.at(-1)![1]
  expect(unknown.to).toEqual({ id: 'missing-chat', title: 'an unknown chat', unknown: true })
  expect(canOpenLetterChat(unknown.to)).toBe(false)
})

it('uses the tree directory metadata and includes node chats without adding hidden sessions', async () => {
  const service = ChatService.getInstance()
  const local = service.getSession(service.createTab())!
  service.createTab()
  const directory = [
    {
      id: local.id,
      title: 'Directory title',
      folder: 'Examples',
      agent: null,
      state: 'failed' as const,
    },
    {
      id: 'node-chat',
      title: 'Remote sample',
      folder: 'Examples/Remote',
      agent: { id: 'provider', name: 'Sample provider' },
      state: 'waiting' as const,
    },
  ]
  const list = vi.spyOn(service, 'listOpenChats').mockReturnValue(directory)
  expect(openMessagingChats().map(({ receive: _receive, path: _path, ...chat }) => chat)).toEqual(
    directory
  )
  expect(list).toHaveBeenCalled()
  expect(chatMessaging.list(local.id)).toEqual([directory[1]])
  await expect(chatMessaging.send(local.id, 'node-chat', 'Sample remote request')).rejects.toThrow(
    'Remote sample is closed. Open it from the chat tree first.'
  )
})

it('opens a node letter destination through its existing tab', async () => {
  const service = ChatService.getInstance()
  vi.spyOn(service, 'getNodeSession').mockReturnValue({} as never)
  const switchTab = vi.spyOn(service, 'switchTab').mockImplementation(() => {})
  await openLetterChat({ id: 'node-chat', title: 'Remote sample' })
  expect(switchTab).toHaveBeenCalledWith('node-chat')
})

it('keeps the caller title on a refused self-addressed letter', async () => {
  const service = ChatService.getInstance()
  const caller = service.getSession(service.createTab())!
  caller.chatTitle.value = 'Sample caller'
  const attach = vi.spyOn(caller, 'attachChatLetter')
  const send = createChatMessagingTools(caller).find(
    (tool) => tool.name === 'send_message_to_chat'
  )!
  await expect(
    send.execute('self-call', { chat_id: caller.id, message: 'Sample self request' })
  ).rejects.toThrow('That is this chat.')
  expect(attach).toHaveBeenLastCalledWith(
    'self-call',
    expect.objectContaining({
      to: expect.objectContaining({ id: caller.id, title: 'Sample caller' }),
      refusal: 'That is this chat.',
    })
  )
})

it('delivers and persists both ends using the receiving session permissions', async () => {
  const service = ChatService.getInstance()
  const a = service.getSession(service.createTab())!
  const b = service.getSession(service.createTab())!
  await a.addUserNote('A question source')
  a.permissionMode.value = 'allow-all'
  b.permissionMode.value = 'confirm-all'
  const answer = await chatMessaging.send(a.id, b.id, 'Explain the example')
  expect(answer).toBe('A sample answer')
  expect(b.messages.value.find((m) => m.role === 'user')?.fromSession?.id).toBe(a.id)
  expect(b.messages.value.findLast((m) => m.role === 'assistant')?.sentTo?.id).toBe(a.id)
  expect(b.permissionMode.value).toBe('confirm-all')
  expect(b.needsApproval('send_message_to_chat', {})).toBe(true)
  expect(a.getToolMode('list_chats')).toBe('auto')
  const reopened = new ChatSession(service)
  await reopened.load(b.currentChatFile.value!)
  expect(reopened.canSendChatLetter).toBe(false)
  await reopened.addUserNote('A new ordinary question')
  expect(reopened.canSendChatLetter).toBe(true)
  expect(reopened.messages.value.findLast((m) => m.role === 'assistant')?.sentTo?.path).toBe(
    a.currentChatFile.value!.path
  )
})

it('waits through a target approval and does not return an earlier answer', async () => {
  const session = new ChatSession(ChatService.getInstance())
  let incoming = false
  vi.spyOn(session, 'sendMessage').mockImplementation(async () => {
    incoming = true
    session.pendingToolCalls.value = [
      { type: 'toolCall', id: 'approval', name: 'write', arguments: {} },
    ]
  })
  const controller = new AbortController()
  const pending = session.receiveChatLetter(
    'Question',
    { id: 'source', title: 'Source' },
    controller.signal
  )
  await vi.waitFor(() => expect(incoming).toBe(true))
  let done = false
  void pending.then(
    () => {
      done = true
    },
    () => {}
  )
  await new Promise((resolve) => setTimeout(resolve, 120))
  expect(done).toBe(false)
  controller.abort()
  await expect(pending).rejects.toThrow('cancelled')
})

it('does not resend an interrupted letter after reloading its saved chat', async () => {
  const session = new ChatSession(ChatService.getInstance())
  await session.addUserNote('Source')
  const append = session as unknown as { appendChatMessage(message: unknown): void }
  append.appendChatMessage({
    id: 'call',
    role: 'tool-call',
    toolCallId: 'letter-call',
    toolName: 'send_message_to_chat',
    toolStatus: 'approved',
    content: '',
    timestamp: 1,
    chatLetter: { to: { id: 'target', title: 'Target' } },
  })
  session.updateVisibleMessages()
  await session.save()
  const reopened = new ChatSession(ChatService.getInstance())
  await reopened.load(session.currentChatFile.value!)
  const letter = reopened.messages.value.find((m) => m.id === 'call')!
  expect(letter.chatLetter?.refusal).toContain('reload')
  expect(letter.toolExecution).toBe('interrupted')
  expect(letter.toolStatus).toBe('rejected')
})

it('registers a read-only listing and an approval-required send tool', () => {
  const tools = createChatMessagingTools(new ChatSession(ChatService.getInstance()))
  expect(tools.map((tool) => tool.name)).toEqual(['list_chats', 'send_message_to_chat'])
  expect(DEFAULT_AI_SETTINGS.toolModes.list_chats).toBe('auto')
  expect(DEFAULT_AI_SETTINGS.toolModes.send_message_to_chat).toBe('ask')
})

it('forces approval when an automatic letter addresses a broader target', async () => {
  const service = ChatService.getInstance()
  const sender = service.getSession(service.createTab())!
  const target = service.getSession(service.createTab())!
  sender.toolModes.value = { ...sender.toolModes.value, send_message_to_chat: 'auto' }
  sender.permissionMode.value = 'confirm-all'
  target.permissionMode.value = 'allow-all'
  expect(sender.needsApproval('send_message_to_chat', { chat_id: target.id })).toBe(true)
  const send = createChatMessagingTools(sender).find((t) => t.name === 'send_message_to_chat')!
  await expect(
    send.execute('unapproved', { chat_id: target.id, message: 'Sample question' }, undefined, {
      session: sender,
      approved: false,
    } as never)
  ).rejects.toThrow('requires owner approval')
  target.permissionMode.value = 'confirm-all'
  target.toolModes.value = { ...target.toolModes.value, eval_js: 'auto' }
  sender.toolModes.value = { ...sender.toolModes.value, eval_js: 'ask' }
  expect(sender.needsApproval('send_message_to_chat', { chat_id: target.id })).toBe(true)
  target.toolModes.value = { ...sender.toolModes.value }
  expect(sender.needsApproval('send_message_to_chat', { chat_id: target.id })).toBe(false)
})

it('withholds sending from delegated runs and ownerless script tools', () => {
  const run = new ChatSession(ChatService.getInstance(), undefined, { kind: 'run', depth: 1 })
  expect(createChatMessagingTools(run).some((t) => t.name === 'send_message_to_chat')).toBe(false)
  expect(createChatMessagingTools().some((t) => t.name === 'send_message_to_chat')).toBe(false)
  expect(createAgentTools().some((t) => t.name === 'send_message_to_chat')).toBe(false)
  expect(getToolRegistry().some((t) => t.name === 'send_message_to_chat')).toBe(true)
  expect(codeToolDescriptions().send_message_to_chat).toBeTruthy()
})

it('withholds sending during a letter turn and restores it after failure', async () => {
  const session = new ChatSession(ChatService.getInstance())
  const cached = createChatMessagingTools(session).find((t) => t.name === 'send_message_to_chat')!
  vi.spyOn(session, 'sendMessage').mockImplementation(async () => {
    expect(createChatMessagingTools(session).some((t) => t.name === 'send_message_to_chat')).toBe(
      false
    )
    await expect(
      cached.execute('chain', { chat_id: 'other', message: 'Question' })
    ).rejects.toThrow('cannot send chat letters')
    throw new Error('Sample interruption')
  })
  await expect(
    session.receiveChatLetter('Question', { id: 'source', title: 'Source' })
  ).rejects.toThrow('Sample interruption')
  expect(createChatMessagingTools(session).some((t) => t.name === 'send_message_to_chat')).toBe(
    true
  )
})

it('never lets an interceptor approve a broader destination for the owner', async () => {
  const service = ChatService.getInstance()
  const sender = service.getSession(service.createTab())!
  const target = service.getSession(service.createTab())!
  target.permissionMode.value = 'allow-all'
  sender.permissionMode.value = 'confirm-all'
  const host = sender as unknown as {
    policyFor(id: string, name: string, args: Record<string, unknown>): Promise<unknown>
    turnPolicy: { decide: () => Promise<unknown> }
  }
  const decide = vi.spyOn(host.turnPolicy, 'decide').mockResolvedValue({ kind: 'approve' })
  await expect(
    host.policyFor('letter', 'send_message_to_chat', { chat_id: target.id })
  ).resolves.toEqual({ kind: 'ask' })
  expect(decide).not.toHaveBeenCalled()
})

it('does not deliver a queued request into a replacement conversation in the same tab', async () => {
  const service = ChatService.getInstance()
  const target = service.getSession(service.createTab())!
  const receiver = openMessagingChats().find((chat) => chat.id === target.id)!
  await target.reset()
  await expect(
    receiver.receive('Queued question', { id: 'source', title: 'Source' })
  ).rejects.toThrow('changed')
})

it('recovers a saved reply when reload happens before its tool result is committed', async () => {
  const session = new ChatSession(ChatService.getInstance())
  await session.addUserNote('Source')
  const host = session as unknown as {
    appendChatMessage(message: unknown): void
    rememberInternal(message: unknown): void
  }
  host.appendChatMessage({
    id: 'answered-call',
    role: 'tool-call',
    toolCallId: 'answered-letter',
    toolName: 'send_message_to_chat',
    toolStatus: 'approved',
    content: '',
    timestamp: 1,
    chatLetter: { to: { id: 'target', title: 'Target' }, reply: 'Retained answer' },
  })
  host.rememberInternal({
    role: 'assistant',
    content: [
      { type: 'toolCall', id: 'answered-letter', name: 'send_message_to_chat', arguments: {} },
    ],
    timestamp: 1,
    chatMessageId: 'answered-call',
  })
  session.updateVisibleMessages()
  await session.save()
  const reopened = new ChatSession(ChatService.getInstance())
  await reopened.load(session.currentChatFile.value!)
  const model = reopened as unknown as { getMessagesForModel(): Message[] }
  const result = model
    .getMessagesForModel()
    .find((m) => m.role === 'toolResult' && m.toolCallId === 'answered-letter')
  expect(result?.content).toEqual([{ type: 'text', text: 'Retained answer' }])
  expect(result?.role === 'toolResult' && result.isError).toBe(false)
  expect(reopened.messages.value.find((m) => m.id === 'answered-call')?.toolResult).toBe(
    'Retained answer'
  )
})

it('keeps a real target tool approval in the receiving chat until it is answered', async () => {
  const service = ChatService.getInstance()
  const a = service.getSession(service.createTab())!
  const b = service.getSession(service.createTab())!
  await a.addUserNote('Source')
  a.permissionMode.value = 'allow-all'
  b.permissionMode.value = 'confirm-all'
  // Existing-file writes ask only after the receiving chat has read the current bytes.
  b.toolModes.value = { ...b.toolModes.value, write: 'ask' }
  await b.sendMessage('Inspect the sample', ['sample.txt'])
  let done = false
  const pending = chatMessaging.send(a.id, b.id, 'Change the sample').then((answer) => {
    done = true
    return answer
  })
  await vi.waitFor(() =>
    expect(b.pendingToolCalls.value[0]?.name, JSON.stringify(b.messages.value)).toBe('write')
  )
  expect(a.pendingToolCalls.value).toEqual([])
  expect(b.canSendChatLetter).toBe(false)
  expect(done).toBe(false)
  await b.rejectToolCall()
  await expect(pending).resolves.toBe('A sample answer')
})

it('adds missing messaging defaults without replacing an explicit permission choice', () => {
  const ai = AbeleConfig.getInstance().ai
  const agent = AgentRegistry.getInstance().defaultAgent()!
  delete agent.toolModes.list_chats
  agent.toolModes.send_message_to_chat = 'off'
  migrateAgents(ai)
  expect(agent.toolModes.list_chats).toBe('auto')
  expect(agent.toolModes.send_message_to_chat).toBe('off')
})
