/**
 * The index behind searching every chat: what it keeps of a chat file, and that it reads a file
 * once and again only when it changes.
 */
import { describe, it, expect, vi } from 'vitest'
import type { App, TFile } from 'obsidian'
import { ChatSearchIndex, extractConversation, searchConversation } from '@/ai/ChatSearchIndex'
import { serializeChat } from '@/ai/ChatLog'
import { foldQuery } from '@/ai/chatFind'
import type { ChatMessage, ChatMetadata } from '@/ai/types'
import type { Message } from '@/ai/client'

const meta = (extra: Partial<ChatMetadata> = {}): ChatMetadata => ({
  type: 'abele-chat',
  providerId: 'p',
  modelId: 'm',
  created: '2026-01-01',
  title: 'Sample chat',
  ...extra,
})

const m = (id: string, role: ChatMessage['role'], content: string, extra = {}): ChatMessage =>
  ({ id, role, content, timestamp: Number(id.replace(/\D/g, '')) || 1, ...extra }) as ChatMessage

const chat = (messages: ChatMessage[], extra: Partial<ChatMetadata> = {}, internal = 0) =>
  serializeChat({
    metadata: meta(extra),
    messages,
    internalMessages: Array.from(
      { length: internal },
      () =>
        ({
          role: 'toolResult',
          content: [{ type: 'text', text: 'INTERNAL-RECORD pumpkin' }],
        }) as unknown as Message
    ),
  })

describe('what the index keeps of a chat', () => {
  it('keeps what the person and the agent said, not tool output, reasoning or drafts', () => {
    const kept = extractConversation(
      chat(
        [
          m('u1', 'user', 'Where does the pumpkin go?'),
          m('t2', 'tool-call', 'Calling read', { parentId: 'u1', toolResult: 'pumpkin in a note' }),
          m('a3', 'assistant', 'By the compost.', { parentId: 't2', thinking: 'pumpkin thoughts' }),
          m('d4', 'user', 'pumpkin draft', { parentId: 'a3', draft: true }),
        ],
        {},
        3
      )
    )
    expect(kept.map((k) => k.id)).toEqual(['u1', 'a3'])
    expect(kept.map((k) => k.text)).toEqual(['Where does the pumpkin go?', 'By the compost.'])
  })

  it('keeps the branch the chat is showing, and a message rewritten later as it was last', () => {
    const content =
      chat(
        [
          m('u1', 'user', 'first question'),
          m('a2', 'assistant', 'old branch answer', { parentId: 'u1' }),
          m('a3', 'assistant', 'new branch answer', { parentId: 'u1' }),
        ],
        { activeLeafId: 'a3' }
      ) +
      JSON.stringify({
        k: 'msg',
        ...m('a3', 'assistant', 'new branch, rewritten', { parentId: 'u1' }),
      }) +
      '\n'
    expect(extractConversation(content).map((k) => k.text)).toEqual([
      'first question',
      'new branch, rewritten',
    ])
  })

  it('reads a chat saved in the old single-object format', () => {
    const legacy = JSON.stringify({
      metadata: meta(),
      messages: [m('u1', 'user', 'legacy pumpkin')],
      internalMessages: [],
    })
    expect(extractConversation(legacy).map((k) => k.text)).toEqual(['legacy pumpkin'])
  })

  it('skips a torn line instead of losing the chat', () => {
    const content = chat([m('u1', 'user', 'whole line')]) + '{"k":"msg","id":"x","ro'
    expect(extractConversation(content).map((k) => k.id)).toEqual(['u1'])
  })
})

describe('searching one chat', () => {
  const kept = extractConversation(
    chat([
      m('u1', 'user', 'Tell me about the pond.'),
      m('a2', 'assistant', 'The pond is small. A pond pump helps.', { parentId: 'u1' }),
    ])
  )

  it('counts every occurrence and opens on the first message holding one', () => {
    const hit = searchConversation('A.abchat', kept, foldQuery('POND'))!
    expect(hit.count).toBe(3)
    expect(hit.messageId).toBe('u1')
    expect(hit.snippet.match).toBe('pond')
    expect(hit.timestamp).toBe(1)
  })

  it('answers nothing for words the chat does not hold', () => {
    expect(searchConversation('A.abchat', kept, foldQuery('orchard'))).toBeNull()
  })
})

describe('the index across chats', () => {
  const file = (path: string, mtime: number) => ({ path, stat: { mtime } }) as unknown as TFile

  function fakeApp(contents: Record<string, string>) {
    const cachedRead = vi.fn(async (f: TFile) => contents[f.path])
    return { app: { vault: { cachedRead } } as unknown as App, cachedRead }
  }

  it('reads each chat once, and again only when it has changed', async () => {
    const contents = {
      'A.abchat': chat([m('u1', 'user', 'pond pump')]),
      'B.abchat': chat([m('u1', 'user', 'orchard')]),
    }
    const { app, cachedRead } = fakeApp(contents)
    const index = new (ChatSearchIndex as unknown as new () => ChatSearchIndex)()

    await index.prepare(app, [file('A.abchat', 1), file('B.abchat', 1)])
    expect(cachedRead).toHaveBeenCalledTimes(2)
    expect([...index.search('pond').keys()]).toEqual(['A.abchat'])

    await index.prepare(app, [file('A.abchat', 1), file('B.abchat', 1)])
    expect(cachedRead).toHaveBeenCalledTimes(2)

    contents['B.abchat'] = chat([m('u1', 'user', 'a pond in the orchard')])
    expect(index.isReady([file('A.abchat', 1), file('B.abchat', 2)])).toBe(false)
    await index.prepare(app, [file('A.abchat', 1), file('B.abchat', 2)])
    expect(cachedRead).toHaveBeenCalledTimes(3)
    expect([...index.search('pond').keys()].sort()).toEqual(['A.abchat', 'B.abchat'])
  })

  it('forgets a chat that is gone', async () => {
    const { app } = fakeApp({ 'A.abchat': chat([m('u1', 'user', 'pond')]) })
    const index = new (ChatSearchIndex as unknown as new () => ChatSearchIndex)()
    await index.prepare(app, [file('A.abchat', 1)])
    await index.prepare(app, [])
    expect(index.size).toBe(0)
    expect(index.search('pond').size).toBe(0)
  })

  it('stops reading when a newer search has taken over, keeping what it read', async () => {
    const contents: Record<string, string> = {}
    const files = Array.from({ length: 30 }, (_, i) => {
      contents[`C${i}.abchat`] = chat([m('u1', 'user', `pond ${i}`)])
      return file(`C${i}.abchat`, 1)
    })
    const { app, cachedRead } = fakeApp(contents)
    const index = new (ChatSearchIndex as unknown as new () => ChatSearchIndex)()
    let batches = 0
    await index.prepare(app, files, undefined, () => ++batches > 1)
    expect(cachedRead.mock.calls.length).toBeLessThan(30)
    expect(index.size).toBe(cachedRead.mock.calls.length)
  })
})
