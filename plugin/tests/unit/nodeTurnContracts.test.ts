import { expect, it } from 'vitest'
import {
  validateParams,
  ReviewResultSchema,
  DelegationSendResultSchema,
} from '@abele/node-protocol'

const expected = {
  target: { kind: 'worktree' as const, worktree_id: 'sample-worktree' },
  incarnation: 'sample-binding',
}
const anchor = {
  node_id: 'sample-node',
  workspace_id: 'sample-workspace',
  diff_id: 'sample-diff',
  path: 'sample.txt',
  side: 'new',
  start_line: 1,
  end_line: 1,
  context_hash: 'a'.repeat(64),
  comment: 'Sample review',
}

it.each([
  ['session.send', { session_id: 'sample-session', text: 'Sample turn', observed_seq: 0 }],
  ['delegation.send', { delegation_id: 'sample-child', text: 'Sample turn', observed_seq: 0 }],
  ['review.submit', { session_id: 'sample-session', observed_seq: 0, anchors: [anchor] }],
])(
  'validates the optional target incarnation on %s without breaking unguarded callers',
  (method, params) => {
    expect(validateParams(method, { ...params, expected_target: expected })).toHaveProperty(
      'expected_target',
      expected
    )
    expect(validateParams(method, params)).not.toHaveProperty('expected_target')
    expect(() =>
      validateParams(method, { ...params, expected_target: { target: expected.target } })
    ).toThrow()
  }
)

it('requests a binding incarnation explicitly while preserving legacy target reads', () => {
  expect(
    validateParams('session.worktree.get', {
      session_id: 'sample-session',
      include_incarnation: true,
    })
  ).toHaveProperty('include_incarnation', true)
  expect(validateParams('session.worktree.get', { session_id: 'sample-session' })).toEqual({
    session_id: 'sample-session',
  })
})

it.each([expected, null])(
  'preserves a typed target refusal, including an unbound destination (%j)',
  (current) => {
    const refusal = { code: 'target_changed', current_target: current }
    expect(ReviewResultSchema.parse(refusal)).toEqual(refusal)
    expect(DelegationSendResultSchema.parse(refusal)).toEqual(refusal)
  }
)
