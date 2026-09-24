/**
 * Comments on a passage of an agent's answer: where the passage is, how it is drawn, and what
 * the comment's agent is told about it.
 *
 * The answer is rendered markdown, not a note, so the anchor is a quote and an offset into the
 * text the reader sees. What is guarded here is that the pair finds its passage again after
 * the answer is drawn anew, that the drawing never adds to the text it measures, and that the
 * agent reading the comment gets the words of the chat and nothing its tools produced.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  selectionAnchor,
  locateQuote,
  paintMessageComments,
  buildMessageCommentContext,
  type PaintedComment,
} from '@/ai/messageComments'
import { serializeChat } from '@/ai/ChatLog'
import type { ChatMessage } from '@/ai/types'

function rendered(html: string): HTMLElement {
  const root = document.createElement('div')
  root.append(...Array.from(new DOMParser().parseFromString(html, 'text/html').body.childNodes))
  document.body.appendChild(root)
  return root
}

function comment(over: Partial<PaintedComment> & Pick<PaintedComment, 'id'>): PaintedComment {
  return { quote: undefined, start: undefined, count: 0, state: 'idle', open: false, ...over }
}

describe('a selection in an answer', () => {
  it('is named by its text and where it starts in what the reader sees', () => {
    const root = rendered('<p>Take the <strong>night train</strong> to Riga.</p><p>Then walk.</p>')
    const range = document.createRange()
    const strong = root.querySelector('strong')!.firstChild!
    range.setStart(strong, 0)
    range.setEnd(root.querySelectorAll('p')[0].lastChild!, 4)

    expect(selectionAnchor(root, range)).toEqual({ quote: 'night train to', start: 9 })
  })

  it('is nothing when it reaches outside the answer', () => {
    const root = rendered('<p>Inside</p>')
    const outside = rendered('<p>Outside</p>')
    const range = document.createRange()
    range.setStart(root.querySelector('p')!.firstChild!, 0)
    range.setEnd(outside.querySelector('p')!.firstChild!, 3)

    expect(selectionAnchor(root, range)).toBeNull()
  })

  it('does not count the comment icons already drawn in it', () => {
    const root = rendered('<p>Take the night train to Riga.</p>')
    paintMessageComments(root, [comment({ id: 'a', quote: 'Take', start: 0, count: 12 })], vi.fn())
    // The icon carries a digit; measured with it, every offset after it would be two off.
    const text = root.querySelector('p')!.lastChild!
    const range = document.createRange()
    range.setStart(text, text.textContent!.indexOf('Riga'))
    range.setEnd(text, text.textContent!.indexOf('Riga') + 4)

    expect(selectionAnchor(root, range)).toEqual({ quote: 'Riga', start: 24 })
  })
})

describe('finding the passage again', () => {
  const text = 'one two one two one'

  it('takes the occurrence at the recorded offset', () => {
    expect(locateQuote(text, 'one', 8)).toEqual({ from: 8, to: 11 })
  })

  it('takes the nearest occurrence when the offset has drifted', () => {
    expect(locateQuote(text, 'one', 15)).toEqual({ from: 16, to: 19 })
  })

  it('finds nothing when the words are gone', () => {
    expect(locateQuote(text, 'three', 0)).toBeNull()
  })
})

describe('drawing comments over an answer', () => {
  it('marks the passage and puts the icon right after it', () => {
    const root = rendered('<p>Take the <strong>night train</strong> to Riga.</p>')
    paintMessageComments(
      root,
      [comment({ id: 'a', quote: 'night train to', start: 9, count: 3 })],
      vi.fn()
    )

    const marks = [...root.querySelectorAll('.abele-comment__quote')]
    expect(marks.map((m) => m.textContent).join('')).toBe('night train to')
    const icon = root.querySelector('.abele-comment-marker')!
    expect(icon.getAttribute('data-comment-ids')).toBe('a')
    expect(icon.querySelector('.abele-comment-marker__count')?.textContent).toBe('3')
    expect(icon.previousSibling?.textContent).toBe(' to')
  })

  it('opens the comment when its icon is pressed', () => {
    const root = rendered('<p>Take the night train.</p>')
    const open = vi.fn()
    paintMessageComments(root, [comment({ id: 'a', quote: 'night', start: 9 })], open)
    ;(root.querySelector('.abele-comment-marker') as HTMLElement).click()

    expect(open).toHaveBeenCalledWith('a')
  })

  it('draws again without doubling anything or changing the text', () => {
    const root = rendered('<p>Take the night train.</p>')
    const before = root.textContent
    const list = [comment({ id: 'a', quote: 'night', start: 9, state: 'busy' })]
    paintMessageComments(root, list, vi.fn())
    paintMessageComments(root, list, vi.fn())

    expect(root.querySelectorAll('.abele-comment-marker')).toHaveLength(1)
    expect(root.querySelectorAll('.abele-comment__quote')).toHaveLength(1)
    expect(root.querySelector('.abele-comment__quote_busy')).not.toBeNull()
    paintMessageComments(root, [], vi.fn())
    expect(root.textContent).toBe(before)
    expect(root.querySelector('.abele-comment__quote')).toBeNull()
  })

  it('keeps a comment whose words are gone reachable, as an icon at the end of the answer', () => {
    const root = rendered('<p>Take the bus.</p>')
    paintMessageComments(root, [comment({ id: 'a', quote: 'night train', start: 9 })], vi.fn())

    expect(root.querySelector('.abele-comment__quote')).toBeNull()
    const icon = root.querySelector('.abele-comment-marker')!
    expect(icon.classList.contains('abele-comment-marker_orphan')).toBe(true)
    expect(root.lastElementChild?.contains(icon)).toBe(true)
  })

  it('puts a comment on the whole answer at its end', () => {
    const root = rendered('<p>Take the bus.</p>')
    paintMessageComments(root, [comment({ id: 'a' })], vi.fn())

    expect(root.querySelector('.abele-comment-marker_orphan')).toBeNull()
    expect(root.querySelector('p')!.lastChild).toBe(root.querySelector('.abele-comment-marker'))
  })
})

describe('what the comment’s agent is told', () => {
  const messages: ChatMessage[] = [
    { id: 'u1', role: 'user', content: 'How do I get to Riga?', timestamp: 1 },
    {
      id: 't1',
      role: 'tool-call',
      content: 'search',
      toolName: 'search',
      toolResult: 'SECRET TOOL OUTPUT',
      parentId: 'u1',
      timestamp: 2,
    },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Take the night train from Vilnius.',
      thinking: 'PRIVATE REASONING',
      parentId: 't1',
      timestamp: 3,
    },
    { id: 'u2', role: 'user', content: 'And back?', parentId: 'a1', timestamp: 4 },
    { id: 'a2', role: 'assistant', content: 'The same train.', parentId: 'u2', timestamp: 5 },
  ]
  const file = serializeChat({
    metadata: {
      type: 'abele-chat',
      title: 'Riga trip',
      providerId: 'p',
      modelId: 'm',
      created: '2026-09-24',
    },
    messages,
    internalMessages: [],
  })
  const anchor = { note: 'AI/Chats/Riga trip.abchat', quote: 'night train', message: 'a1' }

  it('names the chat, the passage and the answer it sits in', () => {
    const context = buildMessageCommentContext(anchor, file)

    expect(context).toContain('Riga trip')
    expect(context).toContain('night train')
    expect(context).toContain('Take the night train from Vilnius.')
    expect(context).toContain('How do I get to Riga?')
  })

  it('carries nothing a tool returned and none of the reasoning', () => {
    const context = buildMessageCommentContext(anchor, file)

    expect(context).not.toContain('SECRET TOOL OUTPUT')
    expect(context).not.toContain('PRIVATE REASONING')
  })

  it('stops at the answer: what came after it is not what was asked about', () => {
    expect(buildMessageCommentContext(anchor, file)).not.toContain('The same train.')
  })

  it('on the person’s own message, names it as theirs and stops there', () => {
    const context = buildMessageCommentContext({ ...anchor, quote: 'Riga', message: 'u2' }, file)

    expect(context).toContain('The message it is in, written by the person:\nAnd back?')
    expect(context).toContain('Take the night train from Vilnius.')
    expect(context).not.toContain('The same train.')
  })

  it('says so when the answer is no longer in the chat', () => {
    const context = buildMessageCommentContext({ ...anchor, message: 'gone' }, file)

    expect(context).toContain('night train')
    expect(context).toMatch(/no longer in that chat/)
  })

  it('says so when the chat itself is gone', () => {
    const context = buildMessageCommentContext(anchor, null)

    expect(context).toContain('night train')
    expect(context).toMatch(/has been deleted/)
  })
})
