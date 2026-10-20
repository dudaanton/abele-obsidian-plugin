import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import { createChatMessagingTools } from '@/ai/tools/ChatMessagingTools'
import { chatMessaging } from '@/ai/chatMessaging'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'
import type { Message } from '@/ai/client'
import { migrateAgents } from '@/ai/agents/migration'

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
  const tools = createChatMessagingTools()
  expect(tools.map((tool) => tool.name)).toEqual(['list_chats', 'send_message_to_chat'])
  expect(DEFAULT_AI_SETTINGS.toolModes.list_chats).toBe('auto')
  expect(DEFAULT_AI_SETTINGS.toolModes.send_message_to_chat).toBe('ask')
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
