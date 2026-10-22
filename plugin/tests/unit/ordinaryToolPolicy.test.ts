import { expect, it } from 'vitest'
import { ordinaryNeedsApproval } from '@/ai/ordinaryToolPolicy'

it('prepares a context instead of dispatching a legacy stale-session command', () => {
  const policy = {
    permissionMode: 'confirm-all' as const,
    getToolMode: () => 'ask' as const,
    outOfScopePath: () => null,
    toolModes: {},
    bookAnchored: false,
    skillNeedsApproval: () => false,
  }
  expect(ordinaryNeedsApproval(policy, 'node_command_run', { session_id: 'missing-session' })).toBe(
    false
  )
})

it('leaves command approval to the exact node card while keeping other actions gated', () => {
  const policy = {
    permissionMode: 'confirm-all' as const,
    outOfScopePath: () => null,
    getToolMode: () => 'ask' as const,
    toolModes: {},
    bookAnchored: false,
    skillNeedsApproval: () => false,
  }
  expect(ordinaryNeedsApproval(policy, 'node_command_run', { session_id: 'sample-session' })).toBe(
    false
  )
  expect(
    ordinaryNeedsApproval(policy, 'node_git_integrate', { session_id: 'sample-session' })
  ).toBe(false)
  for (const name of ['node_git_status', 'node_git_diff', 'node_git_log'])
    expect(ordinaryNeedsApproval(policy, name)).toBe(false)
  expect(ordinaryNeedsApproval(policy, 'node_delegate')).toBe(true)
})

it('exports core read/write policy without treating a missing feature mode as core Off', () => {
  const policy = {
    permissionMode: 'confirm-all' as const,
    outOfScopePath: () => null,
    getToolMode: () => 'off' as const,
    toolModes: {},
    bookAnchored: false,
    skillNeedsApproval: () => false,
  }
  expect(ordinaryNeedsApproval(policy, 'read')).toBe(false)
  expect(ordinaryNeedsApproval(policy, 'edit')).toBe(true)
  expect(ordinaryNeedsApproval({ ...policy, permissionMode: 'allow-edit' }, 'edit')).toBe(false)
  expect(ordinaryNeedsApproval(policy, 'fetch')).toBe(true)
  expect(
    ordinaryNeedsApproval({ ...policy, outOfScopePath: () => 'elsewhere.md' }, 'read', {
      path: 'elsewhere.md',
    })
  ).toBe(true)
})

it('uses only the durable node preparation card for a session-less Ask command', () => {
  const policy = {
    permissionMode: 'confirm-all' as const,
    getToolMode: () => 'ask' as const,
    outOfScopePath: () => null,
    toolModes: {},
    bookAnchored: false,
    skillNeedsApproval: () => false,
  }
  expect(ordinaryNeedsApproval(policy, 'node_command_run', { worktree_id: 'sample-tree' })).toBe(
    false
  )
  expect(
    ordinaryNeedsApproval({ ...policy, permissionMode: 'allow-all' }, 'node_command_run')
  ).toBe(false)
})
