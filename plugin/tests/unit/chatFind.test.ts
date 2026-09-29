/**
 * Finding words in a chat, counted from its messages: which parts of which messages hold them,
 * in reading order, the way the find bar walks them.
 */
import { describe, it, expect } from 'vitest'
import {
  findInMessages,
  foldText,
  occurrences,
  foldQuery,
  searchableParts,
  snippetAt,
  startingMatch,
} from '@/ai/chatFind'
import { textRanges } from '@/ai/chatFindDom'
import type { ChatMessage } from '@/ai/types'

const msg = (id: string, fields: Partial<ChatMessage>): ChatMessage =>
  ({ id, role: 'assistant', content: '', timestamp: 1, ...fields }) as ChatMessage

describe('folding text for matching', () => {
  it('ignores letter case and treats ё as е', () => {
    expect(foldText('Ёлка В ЛЕСУ')).toBe('елка в лесу')
  })

  it('treats a line break as a space, as the drawn text does', () => {
    expect(occurrences(foldText('sample\ngarden'), foldQuery('sample garden'))).toEqual([0])
  })

  it('keeps every offset where it was, even for a letter whose lower case is longer', () => {
    const text = 'İstanbul pier'
    expect(foldText(text)).toHaveLength(text.length)
    expect(occurrences(foldText(text), 'pier')).toEqual([9])
  })

  it('finds nothing for a query that is only spaces', () => {
    expect(foldQuery('   ')).toBe('')
    expect(findInMessages([msg('a', { content: 'a b c' })], '  ')).toEqual([])
  })

  it('counts occurrences without overlapping them', () => {
    expect(occurrences('aaaa', 'aa')).toEqual([0, 2])
  })
})

describe('the parts of a message that are searched', () => {
  it('searches what a user and an agent wrote, and the reasoning folded under an answer', () => {
    const parts = searchableParts(
      msg('a', { content: 'The answer', thinking: 'First, the question' })
    ).map((p) => p.part)
    expect(parts).toEqual(['thinking', 'content'])
  })

  it('searches a tool call by its line, its parameters and as much of its result as is shown', () => {
    const result = 'x'.repeat(1500) + ' tail-only-word'
    const parts = searchableParts(
      msg('t', {
        role: 'tool-call',
        toolName: 'read',
        toolParams: { path: 'Notes/sample-note.md' },
        toolResult: result,
      })
    )
    expect(parts.map((p) => p.part)).toEqual(['tool', 'params', 'result'])
    expect(parts[0].text).toBe('read Notes/sample-note.md')
    // The details print the first thousand characters of a result, and nothing past them.
    expect(
      findInMessages([msg('t', { role: 'tool-call', toolResult: result })], 'tail-only')
    ).toEqual([])
  })

  it('leaves out a successful tool result, which the chat does not show', () => {
    expect(
      searchableParts(msg('r', { role: 'tool-result', content: 'ok', toolStatus: 'approved' }))
    ).toEqual([])
    expect(
      searchableParts(msg('r', { role: 'tool-result', content: 'denied', toolStatus: 'rejected' }))
    ).toEqual([{ part: 'content', text: 'denied' }])
  })

  it('searches a compaction summary as the part folded under its label', () => {
    const summary = 'A long summary of the sample garden conversation. '.repeat(4)
    expect(searchableParts(msg('s', { role: 'system', content: summary }))[0].part).toBe('summary')
    expect(searchableParts(msg('s', { role: 'system', content: 'Model changed' }))[0].part).toBe(
      'content'
    )
  })

  it('counts the interceptor side conversation reply after reply, as one part', () => {
    const found = findInMessages(
      [
        msg('u', {
          role: 'user',
          content: 'plant beans',
          interceptorChat: [
            { id: '1', role: 'assistant', content: 'beans need sun', timestamp: 1 },
            { id: '2', role: 'user', content: 'beans then', timestamp: 2 },
          ],
        }),
      ],
      'beans'
    )
    expect(found).toEqual([
      { messageId: 'u', part: 'content', nth: 0 },
      { messageId: 'u', part: 'interceptor', nth: 0 },
      { messageId: 'u', part: 'interceptor', nth: 1 },
    ])
  })
})

describe('matches across a conversation', () => {
  const conversation = [
    msg('1', { role: 'user', content: 'Where do the tomatoes go?' }),
    msg('2', { content: 'Tomatoes by the fence; tomatoes like sun.', thinking: 'tomatoes' }),
    msg('3', { role: 'user', content: 'And the herbs?' }),
    msg('4', { content: 'Herbs in the middle, away from the tomatoes.' }),
  ]

  it('lists every occurrence in reading order, reasoning before the answer it is under', () => {
    expect(findInMessages(conversation, 'TOMATOES')).toEqual([
      { messageId: '1', part: 'content', nth: 0 },
      { messageId: '2', part: 'thinking', nth: 0 },
      { messageId: '2', part: 'content', nth: 0 },
      { messageId: '2', part: 'content', nth: 1 },
      { messageId: '4', part: 'content', nth: 0 },
    ])
  })

  it('starts from the message at the top of the view rather than the start of the chat', () => {
    const found = findInMessages(conversation, 'tomatoes')
    expect(startingMatch(found, conversation, '3')).toBe(4)
    expect(startingMatch(found, conversation, '2')).toBe(1)
  })

  it('starts on the last match when every one is above the reader, or the view is unknown', () => {
    const found = findInMessages(conversation, 'where')
    expect(startingMatch(found, conversation, '4')).toBe(0)
    expect(startingMatch(findInMessages(conversation, 'tomatoes'), conversation, null)).toBe(4)
    expect(startingMatch([], conversation, '1')).toBe(-1)
  })
})

describe('a snippet around a match', () => {
  it('shows the words found with a few either side, cut at spaces', () => {
    const text = 'word '.repeat(40) + 'the sample pond needs a pump ' + 'word '.repeat(40)
    const at = text.indexOf('pond')
    const snippet = snippetAt(text, at, 4)
    expect(snippet.match).toBe('pond')
    expect(snippet.before.startsWith('…')).toBe(true)
    expect(snippet.after.endsWith('…')).toBe(true)
    expect(snippet.before.length).toBeLessThan(70)
  })

  it('shows a short message whole, on one line', () => {
    expect(snippetAt('a small\npond', 8, 4)).toEqual({
      before: 'a small ',
      match: 'pond',
      after: '',
    })
  })
})

describe('matches on the page', () => {
  it('finds words split across the elements the markdown drew them in', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>The <strong>sample</strong> garden and the Sample shed</p>'
    const ranges = textRanges(el, foldQuery('sample garden'))
    expect(ranges.map((r) => r.toString())).toEqual(['sample garden'])
    expect(textRanges(el, foldQuery('sample')).map((r) => r.toString())).toEqual([
      'sample',
      'Sample',
    ])
  })

  it('places a match that ends where an element ends inside that element', () => {
    const el = document.createElement('div')
    el.innerHTML = '<em>pond</em><span>side</span>'
    const [range] = textRanges(el, 'pond')
    expect(range.endContainer.parentElement?.tagName).toBe('EM')
  })
})
