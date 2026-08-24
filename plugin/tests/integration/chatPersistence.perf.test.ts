/**
 * What a save costs as a conversation grows.
 *
 * A `.abchat` file used to be rewritten in full on every save, and a long agentic chat saves
 * at least once per tool call — so the cost of a turn grew with everything said before it.
 * Measured in the running app, that was 5ms per save at 0.9MB and 27ms at 8.7MB, against 2ms
 * flat for an append.
 *
 * These assertions describe the shape of that cost, not its milliseconds: bytes written per
 * turn must not grow with the conversation, and the file must not be rewritten in full except
 * to compact it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { Message, ModelConfig } from '@/ai/client'

vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream(_model: ModelConfig, _system: string, messages: Message[]) {
      const last = messages[messages.length - 1]
      const asked = typeof last?.content === 'string' ? last.content : ''
      // Long enough that a turn is worth measuring against the file it is appended to.
      const reply = `answer to ${asked}: ` + 'detail '.repeat(120)

      yield { type: 'text_delta' as const, delta: reply }
      yield {
        type: 'done' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: reply }],
          model: 'm1',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          stopReason: 'stop' as const,
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
  models: [{ id: 'm1', name: 'M1', contextWindow: 1000, maxTokens: 100, supportsReasoning: false }],
}

const FAKE_FILE = Object.assign(new TFile(), {
  path: 'Chats/bench.abchat',
  basename: 'bench',
  extension: 'abchat',
})

interface Write {
  kind: 'append' | 'rewrite'
  bytes: number
}

let writes: Write[] = []

beforeEach(() => {
  writes = []
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }
  AgentRegistry.getInstance().setDefault(
    AgentRegistry.getInstance().create({ name: 'Agent', providerId: 'p1', modelId: 'm1' }).id
  )

  vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockImplementation(async (_snapshot, plan) => {
    if (plan.kind === 'append') writes.push({ kind: 'append', bytes: plan.data.length })
    if (plan.kind === 'rewrite') writes.push({ kind: 'rewrite', bytes: plan.content.length })
    return FAKE_FILE
  })
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {
    // Tab state is localStorage and irrelevant to what a chat file costs.
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const TURNS = 30

async function converse(turns: number): Promise<ChatSession> {
  const session = new ChatSession(ChatService.getInstance())
  for (let i = 0; i < turns; i++) {
    await session.sendMessage(`question number ${i} ` + 'context '.repeat(20))
  }
  return session
}

describe('the cost of saving a chat', () => {
  it('reports what a conversation costs to persist', async () => {
    await converse(TURNS)

    const total = writes.reduce((sum, w) => sum + w.bytes, 0)
    const file = writes.reduce((size, w) => (w.kind === 'rewrite' ? w.bytes : size + w.bytes), 0)

    console.info(
      [
        '',
        `  turns ....................... ${TURNS}`,
        `  writes ...................... ${writes.length}`,
        `  full rewrites ............... ${writes.filter((w) => w.kind === 'rewrite').length}`,
        `  bytes written ............... ${total}`,
        `  final file .................. ${file}`,
        `  written / file .............. ${(total / file).toFixed(2)}×`,
        '',
      ].join('\n')
    )

    expect(writes.length).toBeGreaterThan(0)
  })

  it('does not write more as the conversation grows', async () => {
    await converse(TURNS)

    const appends = writes.filter((w) => w.kind === 'append')
    const first = appends[0].bytes
    const last = appends[appends.length - 1].bytes

    // Every turn appends its own messages and nothing else. Rewriting the file instead would
    // make the last turn cost as much as the whole conversation.
    expect(last).toBeLessThan(first * 2)
  })

  it('writes about as many bytes as the conversation weighs, not a multiple of it', async () => {
    await converse(TURNS)

    const total = writes.reduce((sum, w) => sum + w.bytes, 0)
    const file = writes.reduce((size, w) => (w.kind === 'rewrite' ? w.bytes : size + w.bytes), 0)

    // Whole-file rewriting would put this at roughly half the number of turns.
    expect(total / file).toBeLessThan(2)
  })

  it('keeps a change pending when the write fails, rather than dropping it', async () => {
    const session = new ChatSession(ChatService.getInstance())
    const saveChat = vi.spyOn(ChatStorage.getInstance(), 'saveChat')
    saveChat.mockRejectedValueOnce(new Error('disk full'))
    vi.spyOn(console, 'error').mockImplementation(() => {
      // The failure is reported; the test is about what happens to the change.
    })

    await session.sendMessage('a question')
    const afterFailure = writes.length
    await session.save()

    expect(afterFailure).toBe(0)
    expect(writes.length).toBe(1)
  })

  it('rewrites the file only to compact it', async () => {
    await converse(TURNS)

    // One rewrite creates the file; any others are compactions, and they are rare.
    expect(writes.filter((w) => w.kind === 'rewrite').length).toBeLessThanOrEqual(2)
  })

  it('writes once per turn, not once per change within it', async () => {
    await converse(TURNS)

    expect(writes.length).toBeLessThanOrEqual(TURNS + 2)
  })
})
