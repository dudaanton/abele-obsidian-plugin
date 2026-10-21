import { expect, it } from 'vitest'
import { ordinaryNeedsApproval } from '@/ai/ordinaryToolPolicy'

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
