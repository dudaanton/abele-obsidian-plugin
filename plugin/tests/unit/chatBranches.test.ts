import { describe, expect, it } from 'vitest'
import { branchSwitches, newBranchAfter } from '@/ai/chatBranches'
import type { ChatMessage } from '@/ai/types'

const msg = (
  id: string,
  role: ChatMessage['role'],
  t: number,
  parentId?: string,
  extra: Partial<ChatMessage> = {}
): ChatMessage => ({ id, role, content: `text ${id}`, timestamp: t, parentId, ...extra })

// q1 → a1 → { q2 → a2 → q3 → a3 ;  q2b → a2b (a call waiting) }
const all = [
  msg('q1', 'user', 1),
  msg('a1', 'assistant', 2, 'q1'),
  msg('q2', 'user', 3, 'a1'),
  msg('a2', 'assistant', 4, 'q2'),
  msg('q3', 'user', 5, 'a2'),
  msg('a3', 'assistant', 6, 'q3'),
  msg('q2b', 'user', 7, 'a1'),
  msg('t2b', 'tool-call', 8, 'q2b', { toolName: 'write_note', toolStatus: 'pending' }),
]
const path = (...ids: string[]) => ids.map((id) => all.find((m) => m.id === id)!)

describe('branch switches', () => {
  it('stand on the message that differs, not on the one above the fork', () => {
    const switches = branchSwitches(all, path('q1', 'a1', 'q2', 'a2', 'q3', 'a3'))
    expect([...switches.keys()]).toEqual(['q2'])
    const at = switches.get('q2')!
    expect(at.index).toBe(0)
    expect(at.choices.map((c) => c.id)).toEqual(['q2', 'q2b'])
  })

  it('count the questions each way holds and mark one that wants you', () => {
    const at = branchSwitches(all, path('q1', 'a1', 'q2b', 't2b')).get('q2b')!
    expect(at.index).toBe(1)
    expect(at.choices.map((c) => [c.questions, c.tone])).toEqual([
      [2, undefined],
      [1, 'waiting'],
    ])
  })

  it('mark a branch whose own later branch waits for you', () => {
    const nested = [
      ...all,
      msg('a2b', 'assistant', 9, 'q2b'),
      msg('q4', 'user', 10, 'q2b'),
      msg('t4', 'tool-call', 11, 'q4', { toolName: 'write_note', toolStatus: 'rejected' }),
    ]
    const at = branchSwitches(nested, path('q1', 'a1', 'q2', 'a2', 'q3', 'a3')).get('q2')!
    expect(at.choices[1].tone).toBe('failed')
  })

  it('find none in an old chat whose messages are not linked', () => {
    const flat = [msg('f1', 'user', 1), msg('f2', 'assistant', 2), msg('f3', 'user', 3)]
    expect(branchSwitches(flat, flat).size).toBe(0)
  })

  it('treat several beginnings as one more place', () => {
    const twoStarts = [...all, msg('q1b', 'user', 9)]
    expect(branchSwitches(twoStarts, path('q1', 'a1')).get('q1')?.choices).toHaveLength(2)
  })
})

describe('a new branch being written', () => {
  it('is the path stopping at a message that already goes on', () => {
    expect(newBranchAfter(all, path('q1', 'a1'), 'a1')?.id).toBe('a1')
    expect(newBranchAfter(all, path('q1', 'a1', 'q2', 'a2', 'q3', 'a3'), 'a3')).toBeNull()
  })
})
