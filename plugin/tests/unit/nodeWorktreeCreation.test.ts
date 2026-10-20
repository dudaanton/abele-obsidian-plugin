import { expect, it, vi } from 'vitest'
import { waitForWorktreeJob, worktreeDisplayPath } from '@/node/worktreePresentation'

it('follows a creation job until it completes instead of requiring a folder refresh', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ state: 'running' })
    .mockResolvedValue({ state: 'succeeded' })
  expect(await waitForWorktreeJob(read, async () => {})).toMatchObject({ state: 'succeeded' })
  expect(read).toHaveBeenCalledTimes(2)
})
it('uses the branch rather than an opaque folder id', () => {
  expect(worktreeDisplayPath('12345678-1234-1234-1234-123456789abc', 'refs/heads/topic/demo')).toBe(
    'topic/demo'
  )
  expect(worktreeDisplayPath('/sample/external', 'topic')).toBe('/sample/external')
  expect(
    worktreeDisplayPath(
      '/12345678-1234-1234-1234-123456789abc/12345678-1234-1234-1234-123456789abc',
      null
    )
  ).toBe('Detached')
})
