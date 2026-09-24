/**
 * A tool result too big to send, through a whole chat: the model is sent the start and a key,
 * the whole of it is kept on the message, and `read_result` reads it — in the same turn, in a
 * later one, and after the chat has been closed and opened again. Driven the way a model
 * drives it: a fake client asks for tool calls and the real loop runs them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { STORE_OVER, resultKey } from '@/ai/resultStore'
import { estimateTokens } from '@/ai/tokens'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { Message, ModelConfig, ToolCallContent, ToolResultMessage } from '@/ai/client'
import { useVault, configureAbele } from '../helpers/testEnv'

let script: Array<ToolCallContent[] | string> = []
/** What the model was sent on each request. */
let sent: Message[][] = []

vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream(_model: ModelConfig, _system: string, messages: Message[]) {
      sent.push(messages)
      const next = script.shift() ?? 'done'
      const content = typeof next === 'string' ? [{ type: 'text' as const, text: next }] : next
      yield {
        type: 'done' as const,
        message: {
          role: 'assistant' as const,
          content,
          model: 'm1',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          stopReason: typeof next === 'string' ? ('stop' as const) : ('toolUse' as const),
          timestamp: Date.now(),
        },
      }
    }
  }
  return { OpenAIClient }
})

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [
    { id: 'm1', name: 'M1', contextWindow: 100000, maxTokens: 100, supportsReasoning: false },
  ],
}

const TASKS = 2000
let callId = 0
type Call = [name: string, args: Record<string, unknown>]
const call = ([name, args]: Call): ToolCallContent => ({
  type: 'toolCall',
  id: `call_${++callId}`,
  name,
  arguments: args,
})
const internal = (session: ChatSession): Message[] =>
  (session as unknown as { allInternalMessages: Message[] }).allInternalMessages
const text = (r: ToolResultMessage) => r.content.map((c) => c.text).join('')

async function agentDoes(session: ChatSession, ...calls: Call[]): Promise<ToolResultMessage[]> {
  const asked = calls.map(call)
  script = [asked, 'done']
  await session.sendMessage('go')
  return asked.map((tc) => {
    const result = internal(session).find(
      (m): m is ToolResultMessage => m.role === 'toolResult' && m.toolCallId === tc.id
    )
    if (!result) throw new Error(`no result for ${tc.name}`)
    return result
  })
}

function newSession(): ChatSession {
  const session = new ChatSession(ChatService.getInstance())
  session.scopeResolver.fullVaultAccess.value = true
  session.permissionMode.value = 'allow-all'
  // Not a core tool, so off unless the agent has it.
  session.toolModes.value = { read_tasks: 'auto' }
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'generateSummary').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue(undefined)
  return session
}

beforeEach(() => {
  callId = 0
  sent = []
  useVault(
    Array.from({ length: TASKS }, (_, i) => ({
      path: `Tasks/Batch ${Math.floor(i / 100)}/Task ${i + 1}.md`,
      frontmatter: { type: 'task', due: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` },
    }))
  )
  configureAbele()
  AgentRegistry.destroy()
  ChatStorage.destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    chatFolder: 'AI/Chats/{{name}}',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  const registry = AgentRegistry.getInstance()
  registry.setDefault(registry.create({ name: 'D', providerId: 'p1', modelId: 'm1' }).id)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  VaultWatcherWrapper.destroy()
})

describe('a tool result too big to send', () => {
  it('reaches the model as its start and a key, and is kept whole on the message', async () => {
    const [tasks] = await agentDoes(newSession(), ['read_tasks', {}])

    expect(tasks.stored?.key).toBe(resultKey('call_1'))
    expect(tasks.stored!.text.split('\n')).toHaveLength(TASKS * 1 + 1 + 20)
    expect(estimateTokens(text(tasks))).toBeLessThan(STORE_OVER)
    expect(text(tasks)).toContain(`key ${resultKey('call_1')}`)

    // The last request carried the short form, never the stored one.
    const lastRequest = sent[sent.length - 1]
    const carried = lastRequest.find(
      (m): m is ToolResultMessage => m.role === 'toolResult' && m.toolCallId === 'call_1'
    )!
    expect(text(carried)).toBe(text(tasks))
    const { OpenAIClient: Real } = await vi.importActual<typeof import('@/ai/client/OpenAIClient')>(
      '@/ai/client/OpenAIClient'
    )
    const wire = JSON.stringify(
      (
        new Real() as unknown as {
          convertMessages: (s: string, m: Message[], r: boolean) => unknown
        }
      ).convertMessages('', lastRequest, false)
    )
    expect(wire).not.toContain('Task 2000.md')
  })

  it('shows the person under the call what the agent was sent', async () => {
    const session = newSession()
    const [tasks] = await agentDoes(session, ['read_tasks', {}])
    const card = session.messages.value.find((m) => m.toolCallId === 'call_1')
    expect(card?.toolResult).toBe(text(tasks))
  })

  it('can be searched and read on by key, in a later turn', async () => {
    const session = newSession()
    const [tasks] = await agentDoes(session, ['read_tasks', {}])
    const key = tasks.stored!.key
    const [hit, page] = await agentDoes(
      session,
      ['read_result', { key, grep: 'Task 2000.md' }],
      ['read_result', { key, start_line: 1500, end_line: 1502 }]
    )
    expect(hit.isError).toBe(false)
    expect(text(hit)).toMatch(/\d+\t {2}\[ \] Task 2000\.md \| due:2026-01-12/)
    expect(text(page).split('\n').slice(1, 4)).toEqual(
      tasks.stored!.text.split('\n').slice(1499, 1502)
    )
  })

  it('can be read in the same turn it came back in', async () => {
    const session = newSession()
    const key = resultKey('call_1')
    const [, hit] = await agentDoes(
      session,
      ['read_tasks', {}],
      ['read_result', { key, grep: 'Task 1.md' }]
    )
    expect(hit.isError).toBe(false)
    expect(text(hit)).toContain('[ ] Task 1.md')
  })

  it('is still there after the chat is closed and opened again', async () => {
    const session = newSession()
    const [tasks] = await agentDoes(session, ['read_tasks', {}])
    await session.save()
    const file = session.currentChatFile.value as TFile

    const reopened = newSession()
    await reopened.load(file)
    const [hit] = await agentDoes(reopened, [
      'read_result',
      { key: tasks.stored!.key, grep: 'Task 1999.md' },
    ])
    expect(hit.isError).toBe(false)
    expect(text(hit)).toContain('[ ] Task 1999.md')
  })

  it('is not stored when it is small', async () => {
    const [ls] = await agentDoes(newSession(), ['ls', {}])
    expect(ls.stored).toBeUndefined()
    expect(text(ls)).toBe('Tasks/')
  })
})
