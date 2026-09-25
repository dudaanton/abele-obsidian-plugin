/**
 * A queued message goes out whichever way the turn it waited behind comes to an end.
 *
 * Only a turn started by `sendMessage` looked at the queue when it was over. A turn that went
 * on after a tool was approved or refused, or one started again with "retry", finished with
 * the message still sitting above the input: the agent had said its last word, nothing was
 * running, and the message waited for the next one typed by hand. And while a tool approved by
 * hand was running, or a failed request was counting down to its next attempt, the chat was
 * not marked as streaming — so a message typed then was not queued at all but started a
 * second turn in the middle of the first.
 *
 * The loop is faked because none of this is about a model: what matters is which turns are
 * started, with what, and when.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { AgentTool, Message, ToolCallContent } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [{ id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false }],
}

const reply = (text: string): Message =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
    timestamp: 1,
  }) as unknown as Message

const call = (id: string): ToolCallContent => ({
  type: 'toolCall',
  id,
  name: 'demo',
  arguments: { n: id },
})

let session: ChatSession

/** The last message of every request made to the model: what each turn was started for. */
let turns: string[]

/** Run by the tool while it executes, so a test can type something at that moment. */
let duringTool: () => Promise<void> | void

const demoTool = (): AgentTool => ({
  name: 'demo',
  label: 'Demo',
  description: 'A tool that needs to be approved.',
  parameters: {},
  execute: async () => {
    await duringTool()
    return { content: [{ type: 'text' as const, text: 'done' }] }
  },
})

const lastText = (messages: Message[]): string => {
  const last = messages[messages.length - 1]
  if (typeof last.content === 'string') return last.content
  return last.role
}

/**
 * The model, as a list of what each request does. A step that is missing answers and ends
 * the turn, as a model with nothing more to say does.
 */
type Step = (opts: { messages: Message[] }) => Promise<{
  messages: Message[]
  pausedAt?: ToolCallContent[]
}>

function model(...steps: Step[]) {
  vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    turns.push(lastText(opts.messages))
    const step = steps[turns.length - 1]
    if (step) return step(opts)
    return { messages: [...opts.messages, reply('ok')] }
  })
}

/** A request that stops on a call the person has to approve. */
const asksToRunTheTool: Step = async (opts) => ({
  messages: [...opts.messages],
  pausedAt: [call('one')],
})

/** A request during which the person types a message, and which then ends the turn. */
const typedWhileAnswering =
  (text: string): Step =>
  async (opts) => {
    await session.sendMessage(text)
    return { messages: [...opts.messages, reply('finished')] }
  }

destroyChatsAfterEach()

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [provider] }

  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Default', providerId: 'p1', modelId: 'big' })
  registry.setDefault(agent.id)

  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  vi.spyOn(session as unknown as { getTools: () => AgentTool[] }, 'getTools').mockReturnValue([
    demoTool(),
  ])

  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')

  turns = []
  duringTool = () => undefined
})

describe('a message typed while the agent goes on after a tool was answered', () => {
  it('goes out when the agent finishes, after the tool was approved', async () => {
    model(asksToRunTheTool, typedWhileAnswering('one more thing'))
    await session.sendMessage('add the cards')

    await session.approveToolCall()

    expect(turns).toEqual(['add the cards', 'toolResult', 'one more thing'])
    expect(session.queuedMessages.value).toEqual([])
  })

  it('goes out when the agent finishes, after the tool was refused', async () => {
    model(asksToRunTheTool, typedWhileAnswering('one more thing'))
    await session.sendMessage('add the cards')

    await session.rejectToolCall()

    expect(turns).toEqual(['add the cards', 'toolResult', 'one more thing'])
    expect(session.queuedMessages.value).toEqual([])
  })

  it('waits while the approved tool runs, instead of starting a turn in the middle of it', async () => {
    model(asksToRunTheTool)
    await session.sendMessage('add the cards')
    let started = -1
    duringTool = async () => {
      await session.sendMessage('one more thing')
      started = turns.length
    }

    await session.approveToolCall()

    // Nothing new started while the tool ran. The turn went on with the tool's result, and
    // the message came after it — once, not a second time from a turn started early.
    expect(started).toBe(1)
    expect(turns).toEqual(['add the cards', 'toolResult', 'one more thing'])
    const users = session.allMessages.value.filter((m) => m.role === 'user').map((m) => m.content)
    expect(users).toEqual(['add the cards', 'one more thing'])
  })
})

describe('a message typed while a failed request is tried again', () => {
  it('goes out when the retried turn finishes', async () => {
    model(async () => {
      throw new Error('invalid key')
    }, typedWhileAnswering('one more thing'))
    await session.sendMessage('add the cards')
    expect(session.error.value).toBe('invalid key')

    await session.retryRequest()

    expect(turns).toEqual(['add the cards', 'add the cards', 'one more thing'])
    expect(session.queuedMessages.value).toEqual([])
  })

  it('waits out the countdown to the next attempt rather than starting a turn of its own', async () => {
    AbeleConfig.getInstance().ai.autoRetry = { attempts: 1, firstDelayMs: 60_000 }
    model(async () => {
      throw new Error('HTTP 429')
    })
    const first = session.sendMessage('add the cards')
    await vi.waitFor(() => expect(session.retrying.value).not.toBeNull())

    await session.sendMessage('one more thing')

    expect(turns).toEqual(['add the cards'])
    expect(session.queuedMessages.value.map((q) => q.content)).toEqual(['one more thing'])

    // Given up on: the turn is over, and the message is what comes next.
    session.cancelAutoRetry()
    await first

    expect(turns).toEqual(['add the cards', 'one more thing'])
    expect(session.queuedMessages.value).toEqual([])
  })
})

describe('a turn whose housekeeping fails', () => {
  it('still hands the queue a turn', async () => {
    AbeleConfig.getInstance().ai.sequentialAuxiliary = true
    const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
      .summarizer
    vi.spyOn(summarizer, 'generateTitle').mockRejectedValueOnce(new Error('title failed'))
    model(typedWhileAnswering('one more thing'))

    await session.sendMessage('add the cards').catch(() => undefined)

    expect(turns).toEqual(['add the cards', 'one more thing'])
    expect(session.queuedMessages.value).toEqual([])
  })
})
