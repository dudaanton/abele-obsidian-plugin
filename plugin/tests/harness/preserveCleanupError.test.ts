import { expect, it, vi } from 'vitest'
import { preserveCleanupError } from '../e2e/helpers/preserveCleanupError'

it('retains the original failure when cleanup fails too', async () => {
  const original = new Error('sample page lost')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await expect(
      preserveCleanupError(
        async () => {
          throw original
        },
        () => {
          throw Error('sample cleanup failed')
        }
      )
    ).rejects.toBe(original)
    expect(log).toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})

it('fails a successful case when its cleanup fails', async () => {
  await expect(
    preserveCleanupError(
      async () => true,
      () => {
        throw Error('sample cleanup failed')
      }
    )
  ).rejects.toThrow('sample cleanup failed')
})
