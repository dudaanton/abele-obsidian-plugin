/**
 * Words put into a comment without asking anybody anything.
 *
 * A comment is a place in a note as much as it is a chat, and half of what people write in one
 * is for themselves: a reminder, a second thought, something to come back to. Sending that to a
 * model is a wait and a bill for an answer nobody wanted, so a note does the first half of
 * `sendMessage` and stops — the bubble appears, the file gains a line, and no request is made.
 *
 * What makes it worth writing here rather than in the note itself is the last test: the next
 * real question carries the notes to the model as ordinary turns of the conversation.
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

let session: ChatSession
let save: ReturnType<typeof vi.spyOn>

/** The loop, replaced by one that answers once and remembers what it was given. */
function fakeLoop(): { sent: Message[][] } {
  const sent: Message[][] = []
  vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    sent.push([...opts.messages])
    return {
      messages: [
        ...opts.messages,
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'an answer' }],
          stopReason: 'stop',
          timestamp: 1,
        } as unknown as Message,
      ],
    }
  })
  return { sent }
}

beforeEach(() => {
  vi.restoreAllMocks()
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [provider], agents: [] }

  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Comment', providerId: 'p1', modelId: 'big' })
  registry.setDefault(agent.id)

  session = new ChatSession(ChatService.getInstance(), undefined, {
    kind: 'comment',
    anchor: { note: 'Notes/Anchor.md', quote: 'the passage' },
  })
  save = vi.spyOn(session, 'save').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
})

const bubbles = () => session.messages.value.filter((m) => m.role === 'user').map((m) => m.content)

describe('a note kept in a comment', () => {
  it("joins the conversation as the person's own words", async () => {
    await session.addUserNote('Come back to this paragraph')

    expect(bubbles()).toEqual(['Come back to this paragraph'])
  })

  it('asks no model anything', async () => {
    const loop = fakeLoop()

    await session.addUserNote('Come back to this paragraph')

    expect(loop.sent).toEqual([])
    expect(session.isStreaming.value).toBe(false)
  })

  it('reaches the file, because a note nobody saved is a note nobody wrote', async () => {
    await session.addUserNote('Come back to this paragraph')

    expect(save).toHaveBeenCalled()
  })

  it('keeps nothing when there is nothing but whitespace', async () => {
    await session.addUserNote('   ')

    expect(bubbles()).toEqual([])
    expect(save).not.toHaveBeenCalled()
  })

  it('goes to the model with the next real question, as an ordinary turn', async () => {
    const loop = fakeLoop()

    await session.addUserNote('Come back to this paragraph')
    await session.addUserNote('And check the date')
    await session.sendMessage('So what does it say?')

    expect(loop.sent).toHaveLength(1)
    expect(loop.sent[0].map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: 'user', content: 'Come back to this paragraph' },
      { role: 'user', content: 'And check the date' },
      { role: 'user', content: 'So what does it say?' },
    ])
  })
})
