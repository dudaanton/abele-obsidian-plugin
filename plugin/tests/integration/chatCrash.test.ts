/**
 * A chat file after the app was killed in the middle of writing it.
 *
 * Obsidian writes a file by emptying it and writing it a piece at a time, each piece waiting on
 * the main thread, so an app that hangs mid-write and is force-quit leaves the file cut short.
 * A crash at any moment has to leave the whole chat as it was before the write or after it —
 * and a file damaged by an older build has to show everything it still holds, not only what
 * came after the damage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { App, TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { chatCopyPath } from '@/ai/chatCopy'
import { ChatLogWriter, parseChat, serializeChat, type ChatSnapshot } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  DEFAULT_AI_SETTINGS,
  type AiProvider,
  type ChatMessage,
  type ChatMetadata,
} from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'
import type { Message, ModelConfig } from '@/ai/client'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

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

destroyChatsAfterEach()

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

const PATH = 'AI/Chats/Book.abchat'

const metadata = (over: Partial<ChatMetadata> = {}): ChatMetadata =>
  ({ type: 'abele-chat', title: 'Book', created: '2026-09-26', ...over }) as ChatMetadata

/** A conversation that never branched: each message the parent of the next. */
function chain(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    parentId: i ? `m${i}` : undefined,
    role: i % 2 ? 'assistant' : 'user',
    content: `message ${i + 1}`,
    timestamp: i + 1,
  })) as ChatMessage[]
}

const snapshotOf = (messages: ChatMessage[]): ChatSnapshot => ({
  metadata: metadata({ activeLeafId: messages[messages.length - 1].id }),
  messages,
  internalMessages: [],
})

async function chatFile(content: string): Promise<TFile> {
  await app.vault.createFolder('AI/Chats')
  return (await app.vault.create(PATH, content)) as TFile
}

async function reopen(file: TFile): Promise<ChatSession> {
  ChatStorage.destroy()
  const session = newSession()
  await session.load(file)
  return session
}

const shown = (session: ChatSession) => session.messages.value.map((m) => m.id)

describe('a rewrite the app was killed in the middle of', () => {
  /**
   * Obsidian's write as a kill leaves it: the file emptied, and only the pieces that landed
   * before the main thread hung — none at all, or some whole ones, the last line cut.
   */
  function killMidWrite(share: number) {
    const vault = app.vault as unknown as { modify: (f: TFile, c: string) => Promise<void> }
    const modify = vault.modify.bind(vault)
    vi.spyOn(vault, 'modify').mockImplementationOnce(async (file, content) => {
      await modify(file, content.slice(0, Math.floor(content.length * share)))
      throw new Error('killed')
    })
  }

  it.each([
    ['half written', 0.5],
    ['emptied', 0],
  ])('comes back whole, from the copy written before it, when %s', async (_, share) => {
    const before = snapshotOf(chain(4))
    const file = await chatFile(serializeChat(before))
    const after = snapshotOf(chain(12))
    killMidWrite(share)

    await expect(
      ChatStorage.getInstance().saveChat(
        after,
        { kind: 'rewrite', content: serializeChat(after), records: 13 },
        file
      )
    ).rejects.toThrow('killed')
    expect(parseChat(await app.vault.read(file)).messages.length).toBeLessThan(12)

    const session = await reopen(file)

    expect(shown(session)).toEqual(after.messages.map((m) => m.id))
    expect(await app.vault.read(file)).toBe(serializeChat(after))
    expect(await app.vault.adapter.exists(backupOf())).toBe(false)
  })

  it('leaves no copy behind once it finished', async () => {
    const file = await chatFile(serializeChat(snapshotOf(chain(2))))
    const after = snapshotOf(chain(6))

    await ChatStorage.getInstance().saveChat(
      after,
      { kind: 'rewrite', content: serializeChat(after), records: 7 },
      file
    )

    expect(await app.vault.read(file)).toBe(serializeChat(after))
    expect(await app.vault.adapter.exists(backupOf())).toBe(false)
  })

  it('keeps the file when it was the copy that was cut short', async () => {
    const before = snapshotOf(chain(4))
    const file = await chatFile(serializeChat(before))
    const copy = `${PATH}\n${serializeChat(snapshotOf(chain(12)))}`
    await app.vault.adapter.mkdir(backupDir())
    await app.vault.adapter.write(backupOf(), copy.slice(0, Math.floor(copy.length / 2)))

    const session = await reopen(file)

    expect(shown(session)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(await app.vault.adapter.exists(backupOf())).toBe(false)
  })

  it('does not take an old copy over a file that has grown since', async () => {
    const file = await chatFile(serializeChat(snapshotOf(chain(8))) + '{"k":"msg","id":"m9"')
    await app.vault.adapter.mkdir(backupDir())
    await app.vault.adapter.write(backupOf(), `${PATH}\n${serializeChat(snapshotOf(chain(4)))}`)

    const session = await reopen(file)

    expect(shown(session)).toHaveLength(8)
  })
})

describe('a line torn by a crash', () => {
  it('does not swallow the first thing written after it', async () => {
    const torn =
      serializeChat(snapshotOf(chain(4))) + '{"k":"int","role":"tool","content":"half a bo'
    const file = await chatFile(torn)
    const session = await reopen(file)

    await session.sendMessage('after the crash')

    const again = await reopen(file)
    expect(again.messages.value.map((m) => m.content)).toEqual([
      'message 1',
      'message 2',
      'message 3',
      'message 4',
      'after the crash',
      'reply to after the crash',
    ])
    expect(parseChat(await contentOf(again)).damaged).toBe(1)
  })

  it('starts the append on a line of its own after a failed write', () => {
    const writer = new ChatLogWriter()
    const first = snapshotOf(chain(2))
    writer.adopt(parseChat(serializeChat(first)))

    writer.interrupted()
    const plan = writer.plan(snapshotOf(chain(3)))

    expect(plan).toMatchObject({ kind: 'append' })
    expect(plan.kind === 'append' && plan.data.startsWith('\n{')).toBe(true)
  })
})

describe('a file an older build left damaged', () => {
  it('gives back the record glued onto a torn line', async () => {
    const messages = chain(6)
    const lines = serializeChat(snapshotOf(messages)).trim().split('\n')
    // m4's line torn, and the next session's first append — m5 — written straight onto it.
    const m4 = lines[4]
    lines[4] = m4.slice(0, 20) + lines[5]
    lines.splice(5, 1)
    const file = await chatFile(lines.join('\n') + '\n')

    const session = await reopen(file)

    expect(shown(session)).toEqual(['m1', 'm2', 'm3', 'm5', 'm6'])
  })

  it('shows the start of the conversation, not only what came after the lost message', async () => {
    const messages = chain(6).filter((m) => m.id !== 'm3')
    const file = await chatFile(serializeChat(snapshotOf(messages)))

    const session = await reopen(file)

    expect(shown(session)).toEqual(['m1', 'm2', 'm4', 'm5', 'm6'])
  })

  it('opens on what it still holds when the newest message is the one lost', async () => {
    const messages = chain(4)
    const file = await chatFile(
      serializeChat({ ...snapshotOf(messages), metadata: metadata({ activeLeafId: 'm9' }) })
    )

    const session = await reopen(file)

    expect(shown(session)).toEqual(['m1', 'm2', 'm3', 'm4'])
  })
})

/** Where the storage keeps its copy of this chat while rewriting it. */
function backupOf(): string {
  return chatCopyPath(app as unknown as App, PATH)
}

function backupDir(): string {
  return backupOf().slice(0, backupOf().lastIndexOf('/'))
}
