/**
 * A node chat is projected again from its journal on every event. Messages that did not change
 * keep their objects, so the chat redraws only the one that did: a streamed answer does not
 * redraw the hundreds of messages above it at every word.
 */
import { expect, it } from 'vitest'
import type { ChatMessage } from '@/ai/types'
import { StableMessages } from '@/node/stableMessages'

const m = (id: string, content: string): ChatMessage => ({
  id,
  role: 'assistant',
  content,
  timestamp: 1,
})

it('keeps the objects of unchanged messages and takes the changed ones', () => {
  const stable = new StableMessages()
  const first = stable.keep([m('a', 'one'), m('b', 'two')])
  const second = stable.keep([m('a', 'one'), m('b', 'two and more'), m('c', 'three')])
  expect(second[0]).toBe(first[0])
  expect(second[1]).not.toBe(first[1])
  expect(second[1].content).toBe('two and more')
  expect(second.map((x) => x.id)).toEqual(['a', 'b', 'c'])
})

it('forgets messages no longer shown', () => {
  const stable = new StableMessages()
  const first = stable.keep([m('a', 'one')])
  stable.keep([m('b', 'two')])
  expect(stable.keep([m('a', 'one')])[0]).not.toBe(first[0])
})

it('keeps the nested children lists of unchanged parents', () => {
  const stable = new StableMessages()
  const first = stable.children({ p: [m('x', 'child')] })
  const second = stable.children({ p: [m('x', 'child')] })
  expect(second.p).toBe(first.p)
})
