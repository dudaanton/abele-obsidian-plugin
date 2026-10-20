import { expect, it } from 'vitest'
import { nextStep } from '@/components/nodeWork/branchStep'

it('does not offer publication without a remote', () => {
  const state = { base: 'trunk', ahead: 1, behind: 0, unpushed: 0, hasRemote: false }
  expect(nextStep(state, { kind: 'worktree', branch: 'topic' })).toBeNull()
  expect(nextStep({ ...state, hasRemote: true }, { kind: 'worktree', branch: 'topic' })?.id).toBe(
    'publish'
  )
})
