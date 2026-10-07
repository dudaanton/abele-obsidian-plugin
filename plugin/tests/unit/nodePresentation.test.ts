import { expect, it } from 'vitest'
import { shortNodePath, nodeJobLabel, promptExpiry, nodeQueueView } from '@/node/presentation'
import type { ChatMessage } from '@/ai/types'

it('shortens long paths in the middle while preserving both ends', () => {
  const path = '/sample/projects/a-long-repository-name/src/example.ts'
  const short = shortNodePath(path, 32)
  expect(short.length).toBeLessThanOrEqual(32)
  expect(short.startsWith('/sample/')).toBe(true)
  expect(short.endsWith('/example.ts')).toBe(true)
  expect(short).toContain('…')
  expect(shortNodePath('/sample/repo')).toBe('/sample/repo')
})
it('shows human job progress rather than protocol methods or phases', () => {
  expect(
    nodeJobLabel({
      kind: 'workspace.create',
      state: 'succeeded',
      phase: 'worktree_created',
    } as never)
  ).toBe('Workspace created')
  expect(
    nodeJobLabel({ kind: 'workspace.remove', state: 'succeeded', phase: 'remove_intent' } as never)
  ).toBe('Workspace removed')
  expect(
    nodeJobLabel({ kind: 'workspace.create', state: 'running', phase: 'branch_created' } as never)
  ).toBe('Preparing worktree files…')
})
it('shows relative expiry only near the deadline', () => {
  const now = 1000000
  expect(promptExpiry(now + 5 * 60000, now)).toBe('Expires in 5 min')
  expect(promptExpiry(now + 30000, now)).toBe('Expires in less than a minute')
  expect(promptExpiry(now + 3600000, now)).toBe('')
  expect(promptExpiry(undefined, now)).toBe('')
})
const message = (id: string, text = 'Sample follow-up'): ChatMessage => ({
  id: `input:${id}`,
  role: 'user',
  content: text,
  timestamp: 1,
})
it('renders each accepted input once with queue state on its own message', () => {
  const view = nodeQueueView(
    [message('input')],
    [],
    [{ id: 'input', text: 'Sample follow-up' }],
    {}
  )
  expect(view.messages).toHaveLength(1)
  expect(view.states['input:input']).toMatchObject({ label: 'Queued', inputId: 'input' })
})
it('keeps a queued row identity through acceptance using the receipt, not matching text', () => {
  const pending = [{ id: 'operation', text: 'Sample follow-up' }]
  const before = nodeQueueView([], pending, [], {})
  const after = nodeQueueView(
    [message('input')],
    pending,
    [{ id: 'input', text: 'Sample follow-up' }],
    { operation: { result: { input_id: 'input', accepted_seq: 1 } } }
  )
  expect(after.messages).toHaveLength(1)
  expect(after.messages[0].id).toBe(before.messages[0].id)
  expect(after.states[after.messages[0].id]).toMatchObject({ label: 'Queued', inputId: 'input' })
})
it('does not merge two intentional identical messages', () => {
  const view = nodeQueueView(
    [message('one'), message('two')],
    [],
    [
      { id: 'one', text: 'Sample follow-up' },
      { id: 'two', text: 'Sample follow-up' },
    ],
    {}
  )
  expect(view.messages).toHaveLength(2)
  expect(Object.keys(view.states)).toHaveLength(2)
})
