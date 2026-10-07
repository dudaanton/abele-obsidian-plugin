import { describe, expect, it } from 'vitest'
import {
  buildNavigationTree,
  navigationFork,
  navigationSegment,
  navigationBranchLabels,
} from '@/ai/chatNavigationBranches'
import type { ChatMessage } from '@/ai/types'

const message = (id: string, parentId?: string, timestamp = 1): ChatMessage => ({
  id,
  parentId,
  role: 'user',
  content: `Sample ${id}`,
  timestamp,
})
const rows = [
  message('root'),
  message('first', 'root', 2),
  message('later', 'root', 3),
  message('a', 'later', 4),
  message('b', 'later', 5),
  message('end', 'a', 6),
]

describe('navigation forks', () => {
  it('keeps the shared prefix once and exposes only the next fork until a continuation is expanded', () => {
    const tree = buildNavigationTree(rows)
    expect(navigationSegment(tree, 'root').map((m) => m.id)).toEqual(['root'])
    const fork = navigationFork(tree, 'root', ['root', 'later', 'a', 'end'])!
    expect(fork.choices.map((c) => [c.message.id, c.selected])).toEqual([
      ['first', false],
      ['later', true],
    ])
    expect(navigationSegment(tree, 'later').map((m) => m.id)).toEqual(['later'])
    expect(navigationSegment(tree, 'a').map((m) => m.id)).toEqual(['a', 'end'])
    expect(rows).toHaveLength(6)
  })

  it('represents several conversation starts with the same lazy fork model', () => {
    const tree = buildNavigationTree([...rows, message('second-root', undefined, 20)])
    const fork = navigationFork(tree, undefined, ['second-root'])!
    expect(fork.id).toBe('roots')
    expect(fork.choices.map((c) => [c.message.id, c.selected])).toEqual([
      ['root', false],
      ['second-root', true],
    ])
  })

  it('names nested continuations without duplicating shared messages in all-branch search', () => {
    const labels = navigationBranchLabels(buildNavigationTree(rows))
    expect(labels.get('root')).toBe('Shared conversation')
    expect(labels.get('first')).toBe('Continuation 1 of 2')
    expect(labels.get('end')).toBe('Continuation 2 of 2 › Continuation 1 of 2')
    expect(labels.size).toBe(rows.length)
  })

  it('excludes drafts, repairs old linear paths only in copies, and terminates damaged cycles', () => {
    const old = [message('one'), message('two')]
    expect(navigationSegment(buildNavigationTree(old), 'one').map((m) => m.id)).toEqual([
      'one',
      'two',
    ])
    expect(old[1].parentId).toBeUndefined()
    const cyclic = buildNavigationTree([
      message('x', 'y'),
      message('y', 'x'),
      { ...message('draft', 'x'), draft: true },
    ])
    expect(navigationSegment(cyclic, 'x').map((m) => m.id)).toEqual(['x', 'y'])
    expect(cyclic.byId.has('draft')).toBe(false)
    expect(navigationBranchLabels(cyclic).size).toBe(2)
  })
})
