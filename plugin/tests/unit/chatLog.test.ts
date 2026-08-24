/**
 * The `.abchat` log format: what a file holds, and what a save has to write.
 *
 * The point of the format is that a save costs what changed rather than what the conversation
 * weighs, so most of these are about the *plan* — whether a change appends one line, rewrites
 * the file, or does nothing at all.
 */
import { describe, it, expect } from 'vitest'
import {
  serializeChat,
  parseChat,
  ChatLogWriter,
  CHAT_FORMAT_VERSION,
  type ChatSnapshot,
} from '@/ai/ChatLog'
import type { ChatMessage, ChatMetadata } from '@/ai/types'
import type { Message } from '@/ai/client'

const metadata = (over: Partial<ChatMetadata> = {}): ChatMetadata =>
  ({ type: 'abele-chat', title: 'A chat', created: '2026-08-24', ...over }) as ChatMetadata

const message = (id: string, content = 'hello'): ChatMessage =>
  ({ id, role: 'user', content, timestamp: 1 }) as ChatMessage

const internal = (content: string): Message =>
  ({ role: 'assistant', content, timestamp: 1 }) as Message

const snapshot = (over: Partial<ChatSnapshot> = {}): ChatSnapshot => ({
  metadata: metadata(),
  messages: [message('m1')],
  internalMessages: [internal('one')],
  ...over,
})

describe('the file', () => {
  it('is one record per line, starting with the version', () => {
    const lines = serializeChat(snapshot()).trim().split('\n')

    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0])).toMatchObject({
      v: CHAT_FORMAT_VERSION,
      k: 'meta',
      title: 'A chat',
    })
    expect(JSON.parse(lines[1])).toMatchObject({ k: 'msg', id: 'm1' })
    expect(JSON.parse(lines[2])).toMatchObject({ k: 'int', content: 'one' })
  })

  it('reads back what it wrote', () => {
    const original = snapshot({
      messages: [message('m1'), message('m2', 'second')],
      internalMessages: [internal('one'), internal('two')],
    })

    const parsed = parseChat(serializeChat(original))

    expect(parsed.version).toBe(2)
    expect(parsed.metadata).toEqual(original.metadata)
    expect(parsed.messages).toEqual(original.messages)
    expect(parsed.internalMessages).toEqual(original.internalMessages)
  })

  it('lets a later record for a message win, in the message-s original place', () => {
    const content = serializeChat(
      snapshot({ messages: [message('m1', 'first'), message('m2', 'second')] })
    )
    const edited = content + JSON.stringify({ k: 'msg', ...message('m1', 'edited') }) + '\n'

    const parsed = parseChat(edited)

    expect(parsed.messages.map((m) => m.content)).toEqual(['edited', 'second'])
  })

  it('lets a later metadata record win', () => {
    const content =
      serializeChat(snapshot()) +
      JSON.stringify({ v: CHAT_FORMAT_VERSION, k: 'meta', ...metadata({ title: 'Renamed' }) }) +
      '\n'

    expect(parseChat(content).metadata?.title).toBe('Renamed')
  })

  it('loses only the torn line when a write was cut short', () => {
    // The whole point of appending: a crash costs one record, not the conversation.
    const content = serializeChat(snapshot()) + '{"k":"int","content":"half w'

    const parsed = parseChat(content)

    expect(parsed.damaged).toBe(1)
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.internalMessages).toHaveLength(1)
  })
})

describe('a file written by an older build', () => {
  const legacy = {
    metadata: metadata({ title: 'Old chat' }),
    messages: [message('m1')],
    internalMessages: [internal('one')],
  }

  it('is read as version 1 when pretty-printed, as it was written', () => {
    const parsed = parseChat(JSON.stringify(legacy, null, 2))

    expect(parsed.version).toBe(1)
    expect(parsed.metadata?.title).toBe('Old chat')
    expect(parsed.messages).toEqual(legacy.messages)
    expect(parsed.internalMessages).toEqual(legacy.internalMessages)
  })

  it('is read as version 1 even on a single line', () => {
    const parsed = parseChat(JSON.stringify(legacy))

    expect(parsed.version).toBe(1)
    expect(parsed.messages).toEqual(legacy.messages)
  })

  it('reports an unreadable file as empty rather than throwing', () => {
    expect(parseChat('not json at all').messages).toEqual([])
  })
})

describe('planning a save', () => {
  it('writes the whole conversation when the file is new', () => {
    const writer = new ChatLogWriter()

    const plan = writer.plan(snapshot())

    expect(plan.kind).toBe('rewrite')
  })

  it('writes nothing at all when nothing changed', () => {
    const writer = new ChatLogWriter()
    const state = snapshot()
    writer.commit(state, writer.plan(state))

    expect(writer.plan(state).kind).toBe('noop')
  })

  it('appends only the new internal messages', () => {
    const writer = new ChatLogWriter()
    const before = snapshot()
    writer.commit(before, writer.plan(before))

    const after = { ...before, internalMessages: [...before.internalMessages, internal('two')] }
    const plan = writer.plan(after)

    expect(plan.kind).toBe('append')
    expect(plan.kind === 'append' && plan.data.trim().split('\n')).toEqual([
      JSON.stringify({ k: 'int', ...internal('two') }),
    ])
  })

  it('appends only the message that changed', () => {
    const writer = new ChatLogWriter()
    const before = snapshot({ messages: [message('m1'), message('m2')] })
    writer.commit(before, writer.plan(before))

    const after = { ...before, messages: [message('m1'), message('m2', 'answered')] }
    const plan = writer.plan(after)

    expect(plan.kind === 'append' && plan.data.trim().split('\n')).toHaveLength(1)
    expect(plan.kind === 'append' && plan.data).toContain('answered')
  })

  it('appends one line when only the metadata moved', () => {
    // Switching branch changes a single field; it used to rewrite the entire file.
    const writer = new ChatLogWriter()
    const before = snapshot()
    writer.commit(before, writer.plan(before))

    const after = { ...before, metadata: metadata({ activeLeafId: 'm1' }) }
    const plan = writer.plan(after)

    expect(plan.kind === 'append' && plan.data.trim().split('\n')).toHaveLength(1)
  })

  it('rewrites the file once the log outgrows the conversation', () => {
    const writer = new ChatLogWriter()
    let state = snapshot()
    writer.commit(state, writer.plan(state))

    // Repeatedly rewriting the same message piles up records without adding anything live.
    let plan = writer.plan(state)
    for (let i = 0; i < 20; i++) {
      state = { ...state, messages: [message('m1', `edit ${i}`)] }
      plan = writer.plan(state)
      writer.commit(state, plan)
      if (plan.kind === 'rewrite') break
    }

    expect(plan.kind).toBe('rewrite')
    expect(parseChat(plan.kind === 'rewrite' ? plan.content : '').records).toBe(3)
  })

  it('builds a readable file out of the writes it planned', () => {
    // The plans are only correct if the file they produce reads back as the conversation.
    const writer = new ChatLogWriter()
    let state = snapshot()
    let file = ''

    const apply = (next: ChatSnapshot) => {
      state = next
      const plan = writer.plan(state)
      if (plan.kind === 'rewrite') file = plan.content
      else if (plan.kind === 'append') file += plan.data
      writer.commit(state, plan)
    }

    apply(state)
    apply({ ...state, internalMessages: [...state.internalMessages, internal('two')] })
    apply({ ...state, messages: [...state.messages, message('m2', 'second')] })
    apply({ ...state, messages: [message('m1', 'edited'), message('m2', 'second')] })
    apply({ ...state, metadata: metadata({ title: 'Renamed', activeLeafId: 'm2' }) })

    const parsed = parseChat(file)

    expect(parsed.metadata?.title).toBe('Renamed')
    expect(parsed.messages.map((m) => [m.id, m.content])).toEqual([
      ['m1', 'edited'],
      ['m2', 'second'],
    ])
    expect(parsed.internalMessages.map((m) => m.content)).toEqual(['one', 'two'])
  })

  it('appends to a file it has just read', () => {
    const writer = new ChatLogWriter()
    const state = snapshot()
    writer.adopt(parseChat(serializeChat(state)))

    const after = { ...state, internalMessages: [...state.internalMessages, internal('two')] }

    expect(writer.plan(after).kind).toBe('append')
  })

  it('rewrites a file written by an older build, migrating it', () => {
    const writer = new ChatLogWriter()
    const state = snapshot()
    writer.adopt(parseChat(JSON.stringify(state, null, 2)))

    const plan = writer.plan(state)

    expect(plan.kind).toBe('rewrite')
    expect(parseChat(plan.kind === 'rewrite' ? plan.content : '').version).toBe(2)
  })
})
