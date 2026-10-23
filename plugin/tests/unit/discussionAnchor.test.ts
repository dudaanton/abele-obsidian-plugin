import { expect, it, vi } from 'vitest'
import {
  describeCommentContext,
  buildCommentContext,
  COMMENT_WHOLE_NOTE_LIMIT,
} from '@/ai/commentContext'
import { describeMessageCommentContext, buildMessageCommentContext } from '@/ai/messageComments'
import { serializeChat, parseChat } from '@/ai/ChatLog'
import type { ChatMessage } from '@/ai/types'
import { selectionAnchor } from '@/ai/messageComments'

it('describes the note body actually sent at the exact size boundary', () => {
  const anchor = { note: 'Sample.md', quote: 'seed' }
  for (const size of [COMMENT_WHOLE_NOTE_LIMIT - 1, COMMENT_WHOLE_NOTE_LIMIT]) {
    const body = 'x'.repeat(size)
    const facts = describeCommentContext(anchor, body)
    expect(facts.text).toBe(buildCommentContext(anchor, body))
    expect(facts.wholeNote).toBe(size < COMMENT_WHOLE_NOTE_LIMIT)
    expect(facts.characters).toBe(size)
    expect(facts.paragraph).toBe(false)
  }
})

it('counts only included words on the branch through the anchor, including truncation', () => {
  const messages = [
    { id: 'a', role: 'user', content: 'Earlier question', timestamp: 1 },
    { id: 'b', parentId: 'a', role: 'assistant', content: 'Selected answer', timestamp: 2 },
    { id: 'c', parentId: 'a', role: 'assistant', content: 'Sibling answer', timestamp: 3 },
    { id: 'd', parentId: 'b', role: 'user', content: 'Future question', timestamp: 4 },
  ] as ChatMessage[]
  const content = serializeChat({
    metadata: {
      type: 'abele-chat',
      providerId: 'sample',
      modelId: 'sample',
      created: '2024-01-01',
    },
    messages,
    internalMessages: [],
  })
  const anchor = { note: 'Sample.abchat', message: 'b', quote: 'Selected' }
  const facts = describeMessageCommentContext(anchor, content, ['Parent passage'])
  expect(facts.text).toBe(buildMessageCommentContext(anchor, content, ['Parent passage']))
  expect(facts.before).toBe(1)
  expect(facts.answer).toBe(true)
  expect(facts.lineage).toBe(1)
  expect(facts.text).not.toContain('Sibling answer')
  expect(facts.text).not.toContain('Future question')
  messages[0].content = 'x'.repeat(12_001)
  const long = serializeChat({
    metadata: {
      type: 'abele-chat',
      providerId: 'sample',
      modelId: 'sample',
      created: '2024-01-01',
    },
    messages,
    internalMessages: [],
  })
  expect(describeMessageCommentContext(anchor, long).before).toBe(0)
})

it('reports deleted sources and missing answers without inventing sent context', () => {
  const anchor = { note: 'Sample.abchat', message: 'missing', quote: 'Old words' }
  expect(describeMessageCommentContext(anchor, null)).toMatchObject({
    deleted: true,
    answer: false,
    before: 0,
    lineage: 0,
  })
  const content = serializeChat({
    metadata: {
      type: 'abele-chat',
      providerId: 'sample',
      modelId: 'sample',
      created: '2024-01-01',
    },
    messages: [],
    internalMessages: [],
  })
  expect(describeMessageCommentContext(anchor, content)).toMatchObject({
    deleted: false,
    answer: false,
    before: 0,
  })
})

import { ref } from 'vue'
import { resolveDiscussionAnchor, type DiscussionAnchorSources } from '@/ai/discussionAnchor'
import type { ChatSession } from '@/ai/ChatSession'

function fixture(content: string | null, anchor = { note: 'Sample.md', quote: 'seed' }) {
  const session = {
    anchor: ref(anchor),
    commentId: 'sample',
    agent: ref({ id: 'sample-agent', name: 'Sample agent' }),
    toolModes: ref({}),
    needsApproval: () => true,
  } as unknown as ChatSession
  const sources: DiscussionAnchorSources = {
    read: vi.fn(async () => content),
    lineage: vi.fn(async () => []),
    rendered: async (text) => text,
    reveal: vi.fn(),
    agent: vi.fn(),
  }
  return { session, sources }
}

it('opens the source and the effective agent, preserving a changed selection', async () => {
  const { session, sources } = fixture('new words')
  const view = (await resolveDiscussionAnchor(session, sources))!
  expect(view.quote).toBe('seed')
  expect(view.source.missing).toBe('changed')
  view.source.open!()
  expect(sources.reveal).toHaveBeenCalledWith(session)
  view.context.find((row) => row.key === 'agent')!.open!()
  expect(sources.agent).toHaveBeenCalledWith('sample-agent')
  expect(view.context.find((row) => row.key === 'edit')?.detail).toContain('asking first')
})

it('keeps deleted note words but offers no dead link or paragraph', async () => {
  const { session, sources } = fixture(null)
  const view = (await resolveDiscussionAnchor(session, sources))!
  expect(view.source.missing).toBe('deleted')
  expect(view.source.open).toBeUndefined()
  expect(view.context.some((row) => row.key === 'paragraph')).toBe(false)
  expect(view.context.find((row) => row.key === 'note')?.detail).toContain('not sent')
})

it('shows the actual selection edit permission, including off and automatic', async () => {
  const { session, sources } = fixture('seed')
  session.toolModes.value = { edit_selection: 'off' }
  expect(
    (await resolveDiscussionAnchor(session, sources))!.context.some((row) => row.key === 'edit')
  ).toBe(false)
  session.toolModes.value = { edit_selection: 'auto' }
  session.needsApproval = () => false
  expect(
    (await resolveDiscussionAnchor(session, sources))!.context.find((row) => row.key === 'edit')
      ?.detail
  ).toContain('without asking')
})

it('remembers that a selection originated in a code block', () => {
  const root = document.createElement('div')
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = 'const seed = 1'
  pre.append(code)
  root.append(pre)
  const range = document.createRange()
  range.selectNodeContents(root.querySelector('code')!)
  expect(selectionAnchor(root, range)).toMatchObject({ quote: 'const seed = 1', code: true })
})

it('describes a marked paragraph without counting comment syntax as note characters', () => {
  const anchor = { note: 'Sample.md', quote: 'seed' }
  const text = 'The seed%%c:sample%% grows.\n\nAnother paragraph.'
  const facts = describeCommentContext(anchor, text, 'sample')
  expect(facts.paragraph).toBe(true)
  expect(facts.text).toContain('Around it:\nThe seed grows.')
  expect(facts.text).not.toContain('%%c:')
  expect(facts.characters).toBe('The seed grows.\n\nAnother paragraph.'.length)
})

it('describes nested discussions and checks changed rendered answer words', async () => {
  const content = serializeChat({
    metadata: {
      type: 'abele-chat',
      kind: 'comment',
      providerId: 'sample',
      modelId: 'sample',
      created: '2024-01-01',
    },
    messages: [
      { id: 'q', role: 'user', content: 'Which seeds?', timestamp: 1700000000000 },
      { id: 'a', role: 'assistant', content: '**seed** grows', timestamp: 1700000001000 },
    ],
    internalMessages: [],
  })
  const { session, sources } = fixture(content)
  session.anchor.value = { note: 'Sample.abchat', message: 'a', quote: 'seed grows', code: true }
  sources.lineage = async () => ['Outer selected words']
  sources.rendered = async () => 'seed grows'
  let view = (await resolveDiscussionAnchor(session, sources))!
  expect(view.source.missing).toBeUndefined()
  expect(view.source.text).toContain('Which seeds?')
  expect(view.context.find((row) => row.key === 'lineage')?.detail).toContain('1 passages')
  expect(view.context.find((row) => row.key === 'conversation')?.detail).toContain('1 messages')
  expect(view.context.some((row) => row.key === 'edit')).toBe(false)
  expect(view.code).toBe(true)
  sources.rendered = async () => 'other words'
  view = (await resolveDiscussionAnchor(session, sources))!
  expect(view.source.missing).toBe('changed')
  expect(view.source.open).toBeDefined()
})

it('keeps code provenance after saving and reopening the discussion', () => {
  const anchor = { note: 'Sample.abchat', message: 'a', quote: 'const seed = 1', code: true }
  const saved = serializeChat({
    metadata: {
      type: 'abele-chat',
      kind: 'comment',
      anchor,
      providerId: 'sample',
      modelId: 'sample',
      created: '2024-01-01',
    },
    messages: [],
    internalMessages: [],
  })
  expect(parseChat(saved).metadata?.anchor).toEqual(anchor)
})

it('uses book context facts without reading the book as a text note or offering edits', async () => {
  const { session, sources } = fixture('unused')
  session.anchor.value = { note: 'Sample.epub', cfi: 'epubcfi(/6/2)', quote: 'seed' }
  sources.book = async () => ({ deleted: false, around: true })
  const view = (await resolveDiscussionAnchor(session, sources))!
  expect(sources.read).not.toHaveBeenCalled()
  expect(view.source.icon).toBe('book-open')
  expect(view.context.map((row) => row.key)).toEqual(['selection', 'paragraph', 'agent'])
  sources.book = async () => ({ deleted: true, around: false })
  const deleted = (await resolveDiscussionAnchor(session, sources))!
  expect(deleted.source.missing).toBe('deleted')
  expect(deleted.source.open).toBeUndefined()
})
