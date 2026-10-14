/**
 * A question that replies to places of the agent's words.
 *
 * The question keeps the person's words and where each place stands in them; the agent is given
 * links to those places — which message, which words, a few opening words — over the text, never
 * its own words again. Waiting in the queue, repeated, kept in the chat file or put back into the
 * composer, the places go with the question.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider, type ChatReplyTo } from '@/ai/types'
import type { Message } from '@/ai/client'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { replyToken } from '@/ai/replyLinks'
import { useVault } from '../helpers/testEnv'

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

/** A long answer: the agent must be pointed at it, not handed it again. */
const ANSWER =
  'Keep the lamp low through the first hour, then lift it slowly while the plates dry in the open air.'
const places: ChatReplyTo[] = [
  { messageId: 'answer-1', quote: 'the plates dry in the open air', start: 68, at: 0 },
  { messageId: 'answer-2', quote: ANSWER, at: 10 },
]

let session: ChatSession
/** The text of each person's message the model was given, in order. */
let given: string[]

const textOf = (m: Message) =>
  typeof m.content === 'string'
    ? m.content
    : (m.content as { type: string; text?: string }[])
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('')

function fakeLoop(script: (iteration: number) => boolean | void = () => false) {
  return vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    const messages = [...opts.messages]
    for (let iteration = 1; iteration <= 5; iteration++) {
      const injected = opts.beforeIteration ? await opts.beforeIteration() : []
      messages.push(...injected)
      const again = script(iteration)
      messages.push(reply(`answer ${iteration}`))
      if (!again) break
    }
    given = messages.filter((m) => m.role === 'user').map(textOf)
    return { messages }
  })
}

beforeEach(() => {
  useVault([])
  given = []
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [provider] }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Default', providerId: 'p1', modelId: 'big' })
  registry.setDefault(agent.id)
  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
})

afterEach(() => {
  session.destroy()
  vi.restoreAllMocks()
})

const question = () => session.allMessages.value.filter((m) => m.role === 'user').at(-1)

describe('a question with places', () => {
  it('keeps the words and the places, and gives the agent links over the text', async () => {
    fakeLoop()
    await session.sendMessage('How long? Why so?', [], undefined, places)

    expect(question()).toMatchObject({ content: 'How long? Why so?', replyTo: places })
    const text = given.at(-1)!
    expect(text.startsWith('<reply-links>\n')).toBe(true)
    expect(text).toContain(
      '[reply 1] message answer-1, characters 68-98, begins: the plates dry in the open air'
    )
    expect(text).toContain(
      '[reply 2] message answer-2, the whole message, begins: Keep the lamp low through the first hour,…'
    )
    expect(text.endsWith('[reply 1] How long? [reply 2] Why so?')).toBe(true)
    // The agent's own words are not handed back to it.
    expect(text).not.toContain('slowly while')
  })

  it('waits in the queue with its places', async () => {
    session.isStreaming.value = true
    await session.sendMessage('How long? Why so?', [], undefined, places)
    expect(session.queuedMessages.value.map((q) => q.replyTo)).toEqual([places])
  })

  it('gives a queued question its links when the loop takes it', async () => {
    fakeLoop((iteration) => {
      if (iteration === 1) void session.sendMessage('How long? Why so?', [], undefined, places)
      return iteration < 2
    })
    await session.sendMessage('First')
    expect(question()).toMatchObject({ content: 'How long? Why so?', replyTo: places })
    expect(given.at(-1)!.startsWith('<reply-links>')).toBe(true)
  })

  it('repeats with its places', async () => {
    fakeLoop()
    await session.sendMessage('How long? Why so?', [], undefined, places)
    const first = question()!
    session.repeatMessage(first.id)
    await vi.waitFor(() => expect(question()!.id).not.toBe(first.id))
    expect(question()).toMatchObject({ content: 'How long? Why so?', replyTo: places })
  })

  it('keeps its places in the chat file', async () => {
    fakeLoop()
    await session.sendMessage('How long? Why so?', [], undefined, places)
    const snapshot = {
      metadata: { id: 'c', title: 't', createdAt: 1 } as never,
      messages: session.allMessages.value,
      internalMessages: [],
    }
    const read = parseChat(serializeChat(snapshot))
    expect(read.messages.find((m) => m.role === 'user')?.replyTo).toEqual(places)
  })

  it('puts queued places back into the composer when the agent is stopped at an approval', async () => {
    session.isStreaming.value = true
    await session.sendMessage('How long? Why so?', [], undefined, places)
    session.isStreaming.value = false
    session.pendingToolCalls.value = [{ id: 't1', name: 'read', arguments: {} } as never]
    session.stopFromApproval()
    expect(session.draft.value.text).toBe(
      `${replyToken(places[0])}How long? ${replyToken(places[1])}Why so?`
    )
  })

  it('keeps a note with its places', async () => {
    expect(await session.addUserNote('Later.', [places[0]])).toBe(true)
    expect(question()).toMatchObject({ content: 'Later.', replyTo: [places[0]] })
  })
})
