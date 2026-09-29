/**
 * The order of the chat history: by when a chat was last written in, or by when it was started —
 * both read out of the chat's own messages, never out of the file's modification time, which
 * moves for a new title, a summary, sync, a note renamed, anything at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { messageTimes, serializeChat, serializeMetadata } from '@/ai/ChatLog'
import { historyDate, sortHistory } from '@/ai/chatHistoryOrder'
import { ChatStorage } from '@/ai/ChatStorage'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiChatHistoryEntry, type ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 0, 10, 9)

const m = (id: string, at: number, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: 'user', content: id, timestamp: at, ...extra }) as ChatMessage

const chat = (title: string, messages: ChatMessage[], created = '2026-01-01') =>
  serializeChat({
    metadata: { type: 'abele-chat', providerId: 'p', modelId: 'm', created, title },
    messages,
    internalMessages: [],
  })

describe('when a chat was started and last written in, from its file', () => {
  it('reads the first and the last message', () => {
    const content = chat('A', [m('u1', T0), m('a2', T0 + HOUR), m('u3', T0 + 3 * HOUR)])
    expect(messageTimes(content)).toEqual({ first: T0, last: T0 + 3 * HOUR })
  })

  it('is not moved by a message rewritten later, or a new title', () => {
    const content =
      chat('A', [m('u1', T0), m('a2', T0 + HOUR)]) +
      JSON.stringify({ k: 'msg', ...m('u1', T0, { content: 'edited' }) }) +
      '\n' +
      serializeMetadata({
        type: 'abele-chat',
        providerId: 'p',
        modelId: 'm',
        created: '2026-01-01',
        title: 'Renamed',
      })
    expect(messageTimes(content)).toEqual({ first: T0, last: T0 + HOUR })
  })

  it('does not take a timestamp nested inside a message for the message', () => {
    const content = chat('A', [
      m('u1', T0, {
        interceptorChat: [
          { id: 'x', role: 'assistant', content: 'side', timestamp: T0 + 9 * HOUR },
        ],
        toolParams: { timestamp: 1 },
      }),
    ])
    expect(messageTimes(content)).toEqual({ first: T0, last: T0 })
  })

  it('reads a chat in the old single-object format', () => {
    const legacy = JSON.stringify({
      metadata: { type: 'abele-chat', title: 'Old', created: '2025-01-01' },
      messages: [m('u1', T0), m('a2', T0 + HOUR)],
    })
    expect(messageTimes(legacy)).toEqual({ first: T0, last: T0 + HOUR })
  })

  it('ignores maintenance, tools and unsent drafts in both file formats', () => {
    const messages = [
      m('u', T0),
      m('a', T0 + HOUR, { role: 'assistant' }),
      m('compact', T0 + 20 * HOUR, { role: 'system' }),
      m('tool', T0 + 21 * HOUR, { role: 'tool-call' }),
      m('draft', T0 + 22 * HOUR, { draft: true }),
    ]
    for (const content of [chat('Sample', messages), JSON.stringify({ messages })]) {
      expect(messageTimes(content)).toEqual({ first: T0, last: T0 + HOUR })
    }
  })

  it('answers zero for messages without dates', () => {
    const undated = { id: 'old', role: 'user', content: 'A sample question' } as ChatMessage
    expect(messageTimes(chat('Undated', [undated]))).toEqual({ first: 0, last: 0 })
  })

  it('answers zero for a chat with no messages', () => {
    expect(messageTimes(chat('Empty', []))).toEqual({ first: 0, last: 0 })
  })
})

describe('the date a chat is ordered by', () => {
  const entry = (extra: Partial<AiChatHistoryEntry>): AiChatHistoryEntry => ({
    path: 'AI/Chats/A.abchat',
    title: 'A',
    created: '2026-01-05',
    ...extra,
  })
  const file = { stat: { mtime: T0 + 50 * HOUR, ctime: T0 - 50 * HOUR } } as TFile

  it('is the last message, or a stable creation date when no message date is known', () => {
    expect(historyDate(entry({ lastMessageAt: T0 }), 'last', file)).toBe(T0)
    // Modification time must never stand in for an undated conversation.
    expect(historyDate(entry({ lastMessageAt: 0 }), 'last', file)).toBe(
      new Date(2026, 0, 5).getTime()
    )
    expect(historyDate(entry({ lastMessageAt: 0, created: '' }), 'last', file)).toBe(T0 - 50 * HOUR)
    expect(historyDate(entry({ lastMessageAt: 0, created: '' }), 'last', null)).toBe(0)
  })

  it('is the first message for the order by creation, then the created day, then the file', () => {
    expect(historyDate(entry({ firstMessageAt: T0 }), 'created', file)).toBe(T0)
    expect(historyDate(entry({ firstMessageAt: 0 }), 'created', file)).toBe(
      new Date(2026, 0, 5).getTime()
    )
    expect(historyDate(entry({ firstMessageAt: 0, created: '' }), 'created', file)).toBe(
      T0 - 50 * HOUR
    )
  })

  it('sorts newest first, by the order asked for', () => {
    const a = entry({ path: 'a', firstMessageAt: T0, lastMessageAt: T0 + 10 * HOUR })
    const b = entry({ path: 'b', firstMessageAt: T0 + HOUR, lastMessageAt: T0 + 2 * HOUR })
    const fileOf = () => file
    expect(sortHistory([b, a], 'last', fileOf).map((e) => e.path)).toEqual(['a', 'b'])
    expect(sortHistory([a, b], 'created', fileOf).map((e) => e.path)).toEqual(['b', 'a'])
  })
})

describe('the index keeps both dates', () => {
  let app: FakeApp
  const PATH = 'AI/Chats/Sample.abchat'
  const fileAt = (mtime: number) => {
    const f = app.vault.getFileByPath(PATH)!
    f.stat = { ...f.stat, mtime }
    return f
  }

  beforeEach(() => {
    app = useVault([{ path: PATH, raw: chat('Sample', [m('u1', T0), m('a2', T0 + 2 * HOUR)]) }])
    ChatStorage.destroy()
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      chatFolder: 'AI/Chats/{{name}}',
      chatHistory: [],
    }
    AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
    fileAt(1000)
  })

  const entry = () => ChatStorage.getInstance().getHistory()[0]

  it('for a chat it finds in the folder', async () => {
    await ChatStorage.getInstance().refreshHistory()
    expect(entry().firstMessageAt).toBe(T0)
    expect(entry().lastMessageAt).toBe(T0 + 2 * HOUR)
  })

  it('for an entry made before the dates were kept, reading its file once', async () => {
    AbeleConfig.getInstance().ai.chatHistory = [
      { path: PATH, title: 'Sample', created: '2026-01-01', mtime: 1000 },
    ]
    const read = vi.spyOn(app.vault, 'read')
    await ChatStorage.getInstance().refreshHistory()
    expect(entry().lastMessageAt).toBe(T0 + 2 * HOUR)
    await ChatStorage.getInstance().refreshHistory()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('repairs dates cached from maintenance records even when the file has not changed', async () => {
    await app.vault.modify(
      fileAt(1000),
      chat('Sample', [m('u', T0), m('compact', T0 + 20 * HOUR, { role: 'system' })])
    )
    fileAt(1000)
    AbeleConfig.getInstance().ai.chatHistory = [
      {
        path: PATH,
        title: 'Sample',
        created: '2026-01-01',
        mtime: 1000,
        firstMessageAt: T0,
        lastMessageAt: T0 + 20 * HOUR,
      },
    ]
    const read = vi.spyOn(app.vault, 'read')
    await ChatStorage.getInstance().refreshHistory()
    expect(entry().lastMessageAt).toBe(T0)
    await ChatStorage.getInstance().refreshHistory()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('keeps an undated legacy chat in place when its summary is regenerated', async () => {
    const metadata = { type: 'abele-chat', title: 'Sample', created: '2025-01-01' }
    const messages = [{ id: 'old', role: 'user', content: 'A sample question' }]
    await app.vault.modify(fileAt(1000), JSON.stringify({ metadata, messages }))
    fileAt(1000)
    await ChatStorage.getInstance().refreshHistory()
    const before = historyDate(entry(), 'last', fileAt(1000))
    await app.vault.modify(
      fileAt(5000),
      JSON.stringify({
        metadata: { ...metadata, summary: 'A new summary' },
        messages,
      })
    )
    fileAt(5000)
    await ChatStorage.getInstance().refreshHistory()
    expect(entry().lastMessageAt).toBe(0)
    expect(historyDate(entry(), 'last', fileAt(5000))).toBe(before)
    expect(before).toBe(new Date(2025, 0, 1).getTime())
  })

  it('keeps them when the file is touched without a new message', async () => {
    await ChatStorage.getInstance().refreshHistory()
    await app.vault.modify(
      fileAt(5000),
      chat('Sample', [m('u1', T0), m('a2', T0 + 2 * HOUR)]) +
        serializeMetadata({
          type: 'abele-chat',
          providerId: 'p',
          modelId: 'm',
          created: '2026-01-01',
          title: 'Sample',
          summary: 'A summary written later.',
        })
    )
    fileAt(5000)
    await ChatStorage.getInstance().refreshHistory()
    expect(entry().lastMessageAt).toBe(T0 + 2 * HOUR)
  })
})
