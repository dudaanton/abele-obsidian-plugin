import { describe, expect, it } from 'vitest'
import {
  buildChatNavigation,
  navigationPath,
  navigationTitle,
  searchChatNavigation,
} from '@/ai/chatNavigation'
import type { ChatMessage, MessageComment } from '@/ai/types'

const msg = (
  id: string,
  role: ChatMessage['role'],
  content = '',
  extra: Partial<ChatMessage> = {}
): ChatMessage => ({ id, role, content, timestamp: 1000, ...extra })

describe('current conversation navigation', () => {
  it('projects an unopened discussion onto its selected continuation, not the alternative answers', () => {
    const messages = [
      msg('q', 'user', 'Question'),
      msg('a', 'assistant', 'Alternate answer', { parentId: 'q', timestamp: 2 }),
      msg('b', 'assistant', 'Selected answer', { parentId: 'q', timestamp: 3 }),
    ]
    expect(navigationPath(messages, 'b').map((m) => m.id)).toEqual(['q', 'b'])
    expect(navigationPath(messages).map((m) => m.id)).toEqual(['q', 'a'])
  })

  it('repairs legacy and missing-parent links only in preview copies', () => {
    const legacy = [msg('q', 'user'), msg('a', 'assistant')]
    expect(navigationPath(legacy).map((m) => m.id)).toEqual(['q', 'a'])
    expect(legacy[1].parentId).toBeUndefined()
    const damaged = [msg('q', 'user'), msg('a', 'assistant', '', { parentId: 'lost' })]
    expect(navigationPath(damaged, 'a').map((m) => m.id)).toEqual(['q', 'a'])
    expect(damaged[1].parentId).toBe('lost')
  })

  it('terminates a malformed cyclic preview path', () => {
    const messages = [
      msg('a', 'user', '', { parentId: 'b' }),
      msg('b', 'assistant', '', { parentId: 'a' }),
    ]
    expect(navigationPath(messages, 'b').map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('groups the current messages under sent questions, without following parent links or sorting the path', () => {
    const messages = [
      msg('intro', 'assistant', 'An earlier answer'),
      msg('q1', 'user', 'First question', { timestamp: 3000 }),
      msg('a1', 'assistant', 'First answer', { parentId: 'broken' }),
      msg('t1', 'tool-call', '', { toolName: 'read', toolStatus: 'pending' }),
      msg('draft', 'user', 'Not sent', { draft: true }),
      msg('q2', 'user', 'Second question', { timestamp: 2000 }),
      msg('a2', 'assistant', 'Second answer'),
    ]
    const rows = buildChatNavigation(messages, [])
    expect(rows.map((row) => row.message.id)).toEqual(['intro', 'q1', 'q2'])
    expect(rows[1].answers.map((m) => m.id)).toEqual(['a1'])
    expect(rows[1].tools.map((m) => m.id)).toEqual(['t1'])
    expect(rows[1].attention).toBe(true)
    expect(rows[2].answers.map((m) => m.id)).toEqual(['a2'])
    expect(messages).toHaveLength(7)
  })

  it('attaches only direct discussions on this path to the question that owns the answer', () => {
    const comments: MessageComment[] = [
      { id: 'd1', message: 'q1' },
      { id: 'd2', message: 'a1', quote: 'passage' },
      { id: 'other-branch', message: 'hidden' },
      { id: 'unsent', message: 'draft' },
    ]
    const rows = buildChatNavigation(
      [
        msg('q1', 'user', 'Question'),
        msg('a1', 'assistant', 'Answer'),
        msg('draft', 'user', 'Draft', { draft: true }),
      ],
      comments
    )
    expect(rows[0].discussions.map((d) => d.id)).toEqual(['d1', 'd2'])
  })

  it('uses the beginning of text and sensible labels for textless attachments', () => {
    expect(navigationTitle(msg('q', 'user', '  A question\nwith more text  '))).toBe(
      'A question with more text'
    )
    expect(navigationTitle(msg('q', 'user', '', { attachments: ['sample-image.png'] }))).toBe(
      'Image'
    )
    expect(navigationTitle(msg('q', 'user', '', { attachments: ['sample-file.pdf'] }))).toBe(
      'File: sample-file.pdf'
    )
    expect(navigationTitle(msg('q', 'user', '', { attachments: ['one.png', 'two.pdf'] }))).toBe(
      '2 attachments'
    )
    expect(navigationTitle(msg('q', 'user', 'x'.repeat(140)))).toHaveLength(100)
  })

  it('searches available display text, including collapsed answers and tool details, but not drafts', () => {
    const messages = [
      msg('q', 'user', 'Where is the pond?'),
      msg('a', 'assistant', 'Near the shed', { thinking: 'Pond needs shade' }),
      msg('t', 'tool-call', '', {
        toolName: 'read',
        toolResult: 'The pond liner is ready.',
        toolStatus: 'approved',
      }),
      msg('r', 'tool-result', 'pond'),
      msg('d', 'user', 'pond', { draft: true }),
    ]
    const hits = searchChatNavigation(messages, 'POND')
    expect(hits.map((h) => [h.messageId, h.part])).toEqual([
      ['q', 'content'],
      ['a', 'thinking'],
      ['t', 'result'],
    ])
    expect(hits.map((h) => h.snippet.match.toLowerCase())).toEqual(['pond', 'pond', 'pond'])
    expect(searchChatNavigation(messages, '  ')).toEqual([])
  })

  it('keeps old linear chats, system summaries, and orphaned work reachable', () => {
    const rows = buildChatNavigation(
      [
        msg('s', 'system', 'Earlier context'),
        msg('t', 'tool-call', '', { toolName: 'read' }),
        msg('a', 'assistant', 'An answer'),
      ],
      []
    )
    expect(
      rows.flatMap((row) => [
        row.message.id,
        ...row.answers.map((m) => m.id),
        ...row.tools.map((m) => m.id),
      ])
    ).toEqual(['s', 'a', 't'])
  })
})
