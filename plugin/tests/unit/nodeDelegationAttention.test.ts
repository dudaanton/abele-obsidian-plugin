import { expect, it } from 'vitest'
import { delegationAttentionRows } from '@/agents/nodeAttention'
import { nodeDelegationCardFixture } from '@/testing/nodeDelegationFixture'

it('lists working, waiting and finished node developers once by their task titles', () => {
  const card = nodeDelegationCardFixture()
  const rows = delegationAttentionRows(
    [
      { ...card, state: 'running', pendingHumanPrompts: 2 },
      { ...card, sessionId: 'sample-second', state: 'running', pendingHumanPrompts: 0 },
      { ...card, sessionId: 'sample-third', pendingHumanPrompts: 0 },
    ],
    { id: 'sample-registration', expectedNodeId: 'sample-node', label: 'Sample node' }
  )
  expect(rows).toHaveLength(3)
  expect(rows[0].title).toBe(card.title)
  expect(rows[0].reference).toMatchObject({ sessionId: card.sessionId })
  expect(rows[0].reasons[0].kind).toBe('approval')
  expect(rows[1].reasons[0].kind).toBe('running')
  expect(rows[2].reasons[0].kind).toBe('done')
})

it('classifies a deadline-paused developer as interrupted rather than uncertain delivery', () => {
  const rows = delegationAttentionRows(
    [
      {
        ...nodeDelegationCardFixture(),
        state: 'stopped',
        reason: 'time_limit',
        pendingHumanPrompts: 0,
      },
    ],
    { id: 'sample-registration', expectedNodeId: 'sample-node', label: 'Sample node' }
  )
  expect(rows[0].reasons[0].kind).toBe('interrupted')
})
