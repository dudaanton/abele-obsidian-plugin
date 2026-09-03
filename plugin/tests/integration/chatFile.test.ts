/**
 * A chat's file, written and read back for real.
 *
 * Everything else about persistence is tested against a mocked storage; this is the tier that
 * exercises `ChatStorage` itself against a vault — which of create, append and rewrite it
 * reaches for, and whether what lands on disk reads back as the conversation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { parseChat, parseChatMetadata, serializeChat } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider, type SubAgentRunRef } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'
import type { Message, ModelConfig } from '@/ai/client'

vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream(_model: ModelConfig, _system: string, messages: Message[]) {
      const last = messages[messages.length - 1]
      const asked = typeof last?.content === 'string' ? last.content : ''
      const reply = `reply to ${asked}`

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

let app: FakeApp

beforeEach(() => {
  app = useVault([])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
    chatFolder: 'AI/Chats/{{name}}',
    chatHistory: [],
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {
    // Settings live in the plugin's own data file, not in the chat.
  })
  AgentRegistry.getInstance().setDefault(
    AgentRegistry.getInstance().create({ name: 'Agent', providerId: 'p1', modelId: 'm1' }).id
  )
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {
    // Tab state is localStorage and says nothing about the chat file.
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const newSession = () => new ChatSession(ChatService.getInstance())

const fileOf = (session: ChatSession): TFile => {
  const file = session.currentChatFile.value
  if (!file) throw new Error('the chat was never written')
  return file
}

const contentOf = async (session: ChatSession): Promise<string> =>
  (await app.vault.read(fileOf(session))) as string

describe('a new chat', () => {
  it('is created as a log, and says which version wrote it', async () => {
    const session = newSession()

    await session.sendMessage('hello')

    expect(app.stats.create).toBe(1)
    const content = await contentOf(session)
    expect(JSON.parse(content.split('\n')[0])).toMatchObject({ v: 2, k: 'meta' })
    expect(parseChat(content).messages.map((m) => m.content)).toEqual(['hello', 'reply to hello'])
  })

  it('appends the next turn instead of rewriting what is already there', async () => {
    const session = newSession()
    await session.sendMessage('one')
    const afterFirst = await contentOf(session)
    app.resetStats()

    await session.sendMessage('two')

    expect(app.stats.append).toBe(1)
    expect(app.stats.modify).toBe(0)
    const afterSecond = await contentOf(session)
    // Byte-identical prefix: the earlier turn was not touched at all.
    expect(afterSecond.startsWith(afterFirst)).toBe(true)
  })

  it('writes nothing when nothing changed', async () => {
    const session = newSession()
    await session.sendMessage('one')
    app.resetStats()

    await session.save()

    expect(app.stats.append + app.stats.modify + app.stats.create).toBe(0)
  })
})

describe('a chat that branched', () => {
  /** One answer with two continuations; the second is left active. */
  async function branched(): Promise<{ session: ChatSession; otherBranch: string }> {
    const session = newSession()
    await session.sendMessage('one')
    const answer = session.messages.value[1]
    await session.sendMessage('two')
    const otherBranch = session.messages.value[2].id

    session.createBranch(answer.id)
    await session.sendMessage('three')

    return { session, otherBranch }
  }

  it('keeps every branch, not just the one on screen', async () => {
    const { session } = await branched()

    const parsed = parseChat(await contentOf(session))

    expect(parsed.messages).toHaveLength(6)
    expect(session.messages.value.map((m) => m.content)).toEqual([
      'one',
      'reply to one',
      'three',
      'reply to three',
    ])
  })

  it('costs one line to switch branch', async () => {
    const { session, otherBranch } = await branched()
    app.resetStats()

    session.switchBranch(otherBranch)
    await session.save()

    expect(app.stats.modify).toBe(0)
    expect(app.stats.append).toBe(1)
  })

  it('reopens on the branch it was left on', async () => {
    const { session, otherBranch } = await branched()
    session.switchBranch(otherBranch)
    await session.save()

    const reopened = newSession()
    await reopened.load(fileOf(session))

    expect(reopened.allMessages.value).toHaveLength(6)
    expect(reopened.messages.value.map((m) => m.content)).toEqual([
      'one',
      'reply to one',
      'two',
      'reply to two',
    ])
  })
})

describe('a chat that delegated', () => {
  const run: SubAgentRunRef = {
    runId: 'r1',
    agentId: 'a1',
    agentName: 'Worker',
    path: 'AI/Chats/Runs/r1.abchat',
    status: 'done',
    branchCount: 3,
  }

  it('records the run against the message that started it', async () => {
    const session = newSession()
    await session.sendMessage('delegate this')
    const target = session.messages.value[1]
    // A tool call is what a run hangs off; the id is what links the two.
    ;(target as { toolCallId?: string }).toolCallId = 'tc1'

    session.attachSubAgentRun('tc1', run)
    await session.save()

    const parsed = parseChat(await contentOf(session))
    expect(parsed.messages.find((m) => m.id === target.id)?.subAgentRun).toEqual(run)
  })

  it('replaces that one message rather than repeating the conversation', async () => {
    const session = newSession()
    await session.sendMessage('delegate this')
    ;(session.messages.value[1] as { toolCallId?: string }).toolCallId = 'tc1'
    app.resetStats()

    session.attachSubAgentRun('tc1', run)
    await session.save()

    expect(app.stats.append).toBe(1)
    expect(app.stats.written).toBeLessThan(600)
  })

  it('still knows its runs after being reopened', async () => {
    const session = newSession()
    await session.sendMessage('delegate this')
    ;(session.messages.value[1] as { toolCallId?: string }).toolCallId = 'tc1'
    session.attachSubAgentRun('tc1', run)
    await session.save()

    const reopened = newSession()
    await reopened.load(fileOf(session))

    expect(reopened.subAgentRunIds()).toEqual(['r1'])
  })
})

describe('a chat written by an older build', () => {
  const legacy = {
    metadata: {
      type: 'abele-chat',
      title: 'Legacy',
      created: '2026-01-01',
      activeLeafId: 'b',
    },
    messages: [
      { id: 'a', role: 'user', content: 'old question', timestamp: 1 },
      { id: 'b', role: 'assistant', content: 'old answer', timestamp: 2, parentId: 'a' },
    ],
    internalMessages: [
      { role: 'user', content: 'old question', timestamp: 1, chatMessageId: 'a' },
      { role: 'assistant', content: 'old answer', timestamp: 2, chatMessageId: 'b' },
    ],
  }

  async function openLegacy(): Promise<{ session: ChatSession; file: TFile }> {
    const file = (await app.vault.create(
      'AI/Chats/legacy.abchat',
      JSON.stringify(legacy, null, 2)
    )) as TFile
    const session = newSession()
    await session.load(file)
    return { session, file }
  }

  it('opens without being touched', async () => {
    const { session, file } = await openLegacy()
    app.resetStats()

    expect(session.messages.value.map((m) => m.content)).toEqual(['old question', 'old answer'])
    // Reading a chat must not rewrite it: an unchanged conversation stays as it was.
    expect(app.stats.modify + app.stats.append).toBe(0)
    expect(((await app.vault.read(file)) as string).startsWith('{\n')).toBe(true)
  })

  it('is rewritten as a log the first time it changes', async () => {
    const { session, file } = await openLegacy()
    app.resetStats()

    await session.sendMessage('new question')

    expect(app.stats.modify).toBe(1)
    expect(app.stats.append).toBe(0)
    const parsed = parseChat((await app.vault.read(file)) as string)
    expect(parsed.version).toBe(2)
    expect(parsed.messages.map((m) => m.content)).toEqual([
      'old question',
      'old answer',
      'new question',
      'reply to new question',
    ])
    expect(parsed.metadata?.title).toBe('Legacy')
  })

  it('carries the model-s own context across the migration', async () => {
    const { session, file } = await openLegacy()

    await session.sendMessage('new question')

    const parsed = parseChat((await app.vault.read(file)) as string)
    expect(parsed.internalMessages.slice(0, 2).map((m) => m.content)).toEqual([
      'old question',
      'old answer',
    ])
  })

  it('appends from then on', async () => {
    const { session } = await openLegacy()
    await session.sendMessage('new question')
    app.resetStats()

    await session.sendMessage('another')

    expect(app.stats.append).toBe(1)
    expect(app.stats.modify).toBe(0)
  })
})

describe('the file over a long life', () => {
  it('is compacted once the log outgrows the conversation', async () => {
    const session = newSession()
    await session.sendMessage('one')
    ;(session.messages.value[1] as { toolCallId?: string }).toolCallId = 'tc1'

    // Rewriting the same message piles up records without adding anything live, which is what
    // a long-running tool call does as its result is filled in.
    let compacted = false
    for (let i = 0; i < 12 && !compacted; i++) {
      app.resetStats()
      session.attachSubAgentRun('tc1', {
        runId: `r${i}`,
        agentId: 'a1',
        agentName: 'Worker',
        path: `AI/Chats/Runs/r${i}.abchat`,
        status: 'running',
        branchCount: i,
      })
      await session.save()
      compacted = app.stats.modify === 1
    }

    expect(compacted).toBe(true)

    const content = await contentOf(session)
    const parsed = parseChat(content)
    // After a compaction the file holds exactly the conversation, with no history of edits.
    expect(parsed.records).toBe(1 + parsed.messages.length + parsed.internalMessages.length)
    expect(parsed.messages.map((m) => m.content)).toEqual(['one', 'reply to one'])
  })

  it('loses only the torn line when a write was cut short', async () => {
    const session = newSession()
    await session.sendMessage('one')
    await app.vault.append(fileOf(session), '{"k":"int","content":"half writ')

    const reopened = newSession()
    await reopened.load(fileOf(session))

    expect(reopened.messages.value.map((m) => m.content)).toEqual(['one', 'reply to one'])
  })
})

describe('the history list', () => {
  it('reads the current title without parsing the whole conversation', async () => {
    const session = newSession()
    await session.sendMessage('one')
    session.chatTitle.value = 'Renamed later'
    await session.save()

    const metadata = parseChatMetadata(await contentOf(session))

    // The first meta record still carries the old title; the last one is the truth.
    expect(metadata?.title).toBe('Renamed later')
    expect(metadata?.type).toBe('abele-chat')
  })
})

describe('a chat file that holds only metadata', () => {
  /**
   * A comment file is written before its session ever runs a turn, so the guard that stops a
   * brand-new tab creating a file must not also stop an existing file being updated.
   */
  it('is saved when something other than a message changes', async () => {
    const file = await app.vault.create(
      'AI/Chats/empty.abchat',
      serializeChat({
        metadata: {
          type: 'abele-chat',
          providerId: 'p1',
          modelId: 'm1',
          created: '2026-09-02',
          title: 'Empty',
        },
        messages: [],
        internalMessages: [],
      })
    )
    const session = newSession()
    await session.load(file)

    session.chatTitle.value = 'Renamed'
    await session.save()

    expect(parseChatMetadata((await app.vault.read(file)) as string)?.title).toBe('Renamed')
  })
})
