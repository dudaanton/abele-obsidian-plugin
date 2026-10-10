import { expect, it, vi } from 'vitest'
import { openSyncedFile } from '@/sync/openSyncedFile'
it('shows a cannot-get-yet notice and never opens a failed hydration', async () => {
  const open = vi.fn(),
    notice = vi.fn()
  await expect(
    openSyncedFile(
      'Media/file.bin',
      async () => {
        throw new Error('offline')
      },
      open,
      notice
    )
  ).rejects.toThrow('offline')
  expect(open).not.toHaveBeenCalled()
  expect(notice).toHaveBeenCalledWith(
    'Cannot get this file yet: Media/file.bin. Try again when a source is reachable.'
  )
})
it('opens only after hydration succeeds', async () => {
  const events: string[] = []
  await openSyncedFile(
    'file.bin',
    async () => {
      events.push('hydrate')
    },
    async () => {
      events.push('open')
    },
    vi.fn()
  )
  expect(events).toEqual(['hydrate', 'open'])
})
