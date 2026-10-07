import { describe, expect, it } from 'vitest'
import {
  attentionReasons,
  attentionBadge,
  sortAttention,
  type AttentionRow,
} from '@/agents/attention'

const state = { run: { id: 'run-1', at: 10, status: 'running' as const } }
const row = (key: string, reasons: AttentionRow['reasons']): AttentionRow => ({
  key,
  reference: { kind: 'local', path: `${key}.abchat` },
  title: key,
  agent: 'Sample agent',
  source: 'Чат',
  reasons,
})

describe('agent attention', () => {
  it('counts conversations rather than requests, giving attention priority over running', () => {
    const rows = [
      row('a', [
        { kind: 'approval', id: 'request-1', at: 1 },
        { kind: 'approval', id: 'request-2', at: 2 },
        { kind: 'running', id: 'run-1', at: 1 },
      ]),
      row('b', [{ kind: 'running', id: 'run-2', at: 1 }]),
    ]
    expect(attentionBadge(rows, false)).toEqual({
      attention: 1,
      running: 1,
      incomplete: false,
      mark: '1',
    })
    expect(attentionBadge(rows.slice(1), true)).toEqual({
      attention: 0,
      running: 1,
      incomplete: true,
      mark: '·',
    })
    expect(attentionBadge([], true).mark).toBe('')
  })
  it('never guesses a failure from an old file or a question mark', () => {
    expect(attentionReasons({}, [], false)).toEqual([])
  })
  it('restores running work as interrupted, not running', () => {
    expect(attentionReasons(state, [], false)).toEqual([
      { kind: 'interrupted', id: 'run-1', at: 10 },
    ])
    expect(attentionReasons(state, [], true)[0].kind).toBe('running')
  })
  it('keeps a failed run until that particular error is marked seen', () => {
    const errors = [
      { id: 'failure-1', at: 20, text: 'Sample failure', seen: true },
      { id: 'failure-2', at: 30, text: 'New sample failure' },
    ]
    expect(attentionReasons({ errors }, [], false)).toEqual([
      { kind: 'error', id: 'failure-2', at: 30, text: 'New sample failure', target: undefined },
    ])
  })
  it('keeps interrupted explicit questions and approval request identities', () => {
    const question = {
      id: 'question-1',
      at: 5,
      status: 'waiting' as const,
      currentIndex: 0,
      answers: [],
      questions: [{ question: 'Which sample?', options: ['One', 'Two'] }],
      target: 'message-1',
    }
    const reasons = attentionReasons({ question }, [{ id: 'approval-1', name: 'edit' }], false)
    expect(reasons).toContainEqual({
      kind: 'question',
      id: 'question-1',
      at: 5,
      text: 'Which sample?',
      target: 'message-1',
      interrupted: true,
    })
    expect(reasons).toContainEqual({ kind: 'approval', id: 'approval-1', at: 0, text: 'edit' })
  })
  it('sorts close expiry first, then oldest waits, stably within a session', () => {
    const rows = [
      row('b', [{ kind: 'question', id: 'q', at: 20 }]),
      row('a', [{ kind: 'approval', id: 'p', at: 10, expires: 100 }]),
      row('c', [{ kind: 'error', id: 'e', at: 5 }]),
    ]
    expect(sortAttention(rows).map((r) => r.key)).toEqual(['a', 'c', 'b'])
  })
})
