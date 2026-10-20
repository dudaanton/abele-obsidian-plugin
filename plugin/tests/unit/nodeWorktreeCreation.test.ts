import { expect, it, vi } from 'vitest'
import { waitForWorktreeJob, worktreeDisplayPath } from '@/node/worktreePresentation'

it('uses the branch for encoded managed folder names without decoding ordinary paths', () => {
  expect(
    worktreeDisplayPath('/sample/project.worktrees/topic%2Fdemo', 'refs/heads/topic/demo')
  ).toBe('topic/demo')
  expect(worktreeDisplayPath('/sample/literal%20folder', null)).toBe('/sample/literal%20folder')
  expect(worktreeDisplayPath('/sample/external', 'external')).toBe('/sample/external')
})

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
