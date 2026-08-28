/**
 * Messages typed while the agent is working.
 *
 * Sending was refused outright while a turn was running: the call returned, the text was
 * gone, and a correction thought of halfway through an answer had to be held by the person
 * until the agent stopped. Now it waits, and the loop picks it up at its next iteration —
 * before the next reply or tool call — rather than after the whole turn.
 *
 * The agent loop is faked because none of this is about a model. What matters is which
 * messages the loop is handed and when, so the fake is written as a script of iterations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { Message } from '@/ai/client'
import { useVault } from '../helpers/testEnv'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [{ id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false }],
}

/** An assistant message with nothing to call, which ends a turn. */
const reply = (text: string): Message =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
    timestamp: 1,
  }) as unknown as Message

let session: ChatSession

/**
 * Runs the fake loop, letting the test act between iterations.
 *
 * `script` is called once per iteration with the messages injected before it; returning false
 * ends the turn. This is the shape of the real loop reduced to the only part these tests care
 * about: `beforeIteration` runs before every request to the model.
 */
function fakeLoop(script: (injected: Message[], iteration: number) => boolean | void) {
  return vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    const messages = [...opts.messages]
    for (let iteration = 1; iteration <= 10; iteration++) {
      const injected = opts.beforeIteration ? await opts.beforeIteration() : []
      messages.push(...injected)
      const again = script(injected, iteration)
      messages.push(reply(`answer ${iteration}`))
      if (!again) break
    }
    return { messages }
  })
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [provider] }

  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Default', providerId: 'p1', modelId: 'big' })
  registry.setDefault(agent.id)

  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)

  // A finished turn also names the chat and considers compacting it. Both talk to a model,
  // and neither has anything to do with what is queued.
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
})

/** What the person sees in the conversation. */
const bubbles = () =>
  session.allMessages.value.filter((m) => m.role === 'user').map((m) => m.content)

describe('sending while the agent is working', () => {
  it('waits instead of being thrown away', async () => {
    session.isStreaming.value = true

    await session.sendMessage('and also check the dates')

    expect(session.queuedMessages.value.map((q) => q.content)).toEqual(['and also check the dates'])
  })

  it('is not in the conversation until the agent is given it', async () => {
    session.isStreaming.value = true

    await session.sendMessage('and also check the dates')

    expect(bubbles()).toEqual([])
  })

  it('reaches the loop at its next iteration, not after the turn', async () => {
    const seen: string[][] = []
    fakeLoop((injected, iteration) => {
      seen.push(injected.map((m) => String(m.content)))
      // Typed while the model was answering the first time.
      if (iteration === 1) void session.sendMessage('and also check the dates')
      return iteration < 3
    })

    await session.sendMessage('summarise these notes')

    expect(seen).toEqual([[], ['and also check the dates'], []])
  })

  it('joins the conversation when it goes in, in the order it was sent', async () => {
    fakeLoop((_injected, iteration) => {
      if (iteration === 1) {
        void session.sendMessage('first correction')
        void session.sendMessage('second correction')
      }
      return iteration < 2
    })

    await session.sendMessage('summarise these notes')

    expect(bubbles()).toEqual(['summarise these notes', 'first correction', 'second correction'])
  })

  it('gets a turn of its own when the loop had already finished with it', async () => {
    const turns: string[] = []
    vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
      const last = opts.messages[opts.messages.length - 1]
      turns.push(String(last.content))
      // Nothing is injected: this stands for a message typed after the loop's last iteration.
      if (turns.length === 1) {
        session.isStreaming.value = true
        await session.sendMessage('one more thing')
        session.isStreaming.value = false
      }
      return { messages: [...opts.messages, reply('done')] }
    })

    await session.sendMessage('summarise these notes')

    expect(turns).toEqual(['summarise these notes', 'one more thing'])
    expect(session.queuedMessages.value).toEqual([])
  })
})

describe('a queue that is no longer wanted', () => {
  it('is dropped when the agent is stopped, and handed back rather than lost', async () => {
    session.isStreaming.value = true
    await session.sendMessage('and also check the dates')

    const taken = session.takeQueuedMessages()
    session.abort()

    expect(taken.map((q) => q.content)).toEqual(['and also check the dates'])
    expect(session.queuedMessages.value).toEqual([])
  })

  it('is emptied by stopping even when nobody took it', async () => {
    session.isStreaming.value = true
    await session.sendMessage('and also check the dates')

    session.abort()

    expect(session.queuedMessages.value).toEqual([])
  })

  it('loses only the message that was withdrawn', async () => {
    session.isStreaming.value = true
    await session.sendMessage('keep this')
    await session.sendMessage('drop this')

    const dropped = session.queuedMessages.value[1]
    session.removeQueuedMessage(dropped.id)

    expect(session.queuedMessages.value.map((q) => q.content)).toEqual(['keep this'])
  })
})
