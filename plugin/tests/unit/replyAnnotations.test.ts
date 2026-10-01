import { describe, expect, it } from 'vitest'
import {
  acceptRevision,
  undoRevision,
  sourcePassage,
  projectReplyHistory,
} from '@/ai/replyAnnotations'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { EMPTY_USAGE, type Message } from '@/ai/client'
import type { ChatMessage } from '@/ai/types'

const reply = (): ChatMessage => ({
  id: 'reply',
  role: 'assistant',
  content: 'A small lantern glows.',
  timestamp: 1,
})
const proposal = () => ({
  id: 'proposal',
  message: 'reply',
  parent: 'sample-chat.abchat',
  before: 'A small lantern glows.',
  from: 2,
  old: 'small lantern',
  text: 'bright lamp',
  request: 'Please rewrite this passage.',
  author: 'Sample editor',
  at: 2,
  status: 'pending' as const,
})

describe('reviewed reply revisions', () => {
  it('changes only the approved passage and keeps original, author and time through a log round trip', () => {
    const original = reply()
    const edited = acceptRevision(original, proposal(), 3)
    expect(original.content).toBe('A small lantern glows.')
    expect(edited.content).toBe('A bright lamp glows.')
    expect(edited.revisions?.[0]).toMatchObject({
      before: original.content,
      after: edited.content,
      author: 'Sample editor',
      at: 3,
      proposal: 'proposal',
    })
    const parsed = parseChat(
      serializeChat({
        metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '' },
        messages: [edited],
        internalMessages: [],
      })
    )
    expect(parsed.messages[0]).toEqual(edited)
    expect(undoRevision(edited, 4).content).toBe(original.content)
  })

  it('refuses stale, malformed, already decided and non-assistant proposals', () => {
    expect(() => acceptRevision({ ...reply(), content: 'Different.' }, proposal(), 3)).toThrow(
      /changed/
    )
    expect(() => acceptRevision(reply(), { ...proposal(), from: 3 }, 3)).toThrow(/passage/)
    expect(() => acceptRevision(reply(), { ...proposal(), status: 'rejected' }, 3)).toThrow(
      /pending/
    )
    expect(() => acceptRevision({ ...reply(), role: 'user' }, proposal(), 3)).toThrow(/reply/)
  })

  it('does not guess which repeated or formatted source passage was selected', () => {
    expect(sourcePassage('A **small** lantern.', 'small')).toEqual({ from: 4, old: 'small' })
    expect(() => sourcePassage('lamp then lamp', 'lamp')).toThrow(/ambiguous/)
    expect(() => sourcePassage('A **small** lantern.', 'small lantern')).toThrow(/markdown/)
  })

  it('projects edited text into provider history without changing persisted internal messages or tool blocks', () => {
    const internal: Message[] = [
      {
        role: 'assistant',
        chatMessageId: 'reply',
        content: [
          { type: 'thinking', thinking: 'reason' },
          { type: 'text', text: reply().content },
          { type: 'toolCall', id: 't', name: 'read', arguments: {} },
        ],
        timestamp: 1,
        model: 'sample',
        stopReason: 'toolUse',
        usage: EMPTY_USAGE,
      },
    ]
    const edited = acceptRevision(reply(), proposal(), 3)
    const projected = projectReplyHistory([edited], internal)
    expect(projected[0].content).toEqual([
      { type: 'thinking', thinking: 'reason' },
      { type: 'text', text: edited.content },
      { type: 'toolCall', id: 't', name: 'read', arguments: {} },
    ])
    expect((internal[0].content as { text?: string }[])[1].text).toBe(reply().content)
  })

  it('keeps highlights as visual annotations, round-trips them, and restores them on undo', () => {
    const message = {
      ...reply(),
      highlights: [{ id: 'mark', quote: 'small', start: 2, color: 'yellow' as const }],
    }
    const edited = acceptRevision(message, proposal(), 3)
    expect(edited.highlights).toEqual([])
    expect(undoRevision(edited, 4).highlights).toEqual(message.highlights)
    const parsed = parseChat(
      serializeChat({
        metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '' },
        messages: [message],
        internalMessages: [],
      })
    )
    expect(parsed.messages[0].highlights).toEqual(message.highlights)
  })
})
