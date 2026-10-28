import { expect, it, vi } from 'vitest'
import { assertPhysicalPath } from '@/sync/external/projection'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'

vi.mock('@/sync/external/projection', async (original) => {
  const actual = await original<typeof import('@/sync/external/projection')>()
  return { ...actual, assertPhysicalPath: vi.fn(actual.assertPhysicalPath) }
})

it('reuses a validated mapping until either placement root changes', () => {
  const validate = vi.mocked(assertPhysicalPath)
  const placement = new LocalFolderPlacement('Shared', 'Moved')
  validate.mockClear()
  for (let i = 0; i < 5; i++)
    expect(placement.toLocal('Shared/Nested/sample.md')).toBe('Moved/Nested/sample.md')
  expect(validate).toHaveBeenCalledTimes(1)
  placement.local = 'Elsewhere'
  expect(placement.toLocal('Shared/Nested/sample.md')).toBe('Elsewhere/Nested/sample.md')
  expect(validate).toHaveBeenCalledTimes(2)
  placement.server = 'Other'
  expect(() => placement.toLocal('Shared/Nested/sample.md')).toThrow(/outside this connection/)
})
