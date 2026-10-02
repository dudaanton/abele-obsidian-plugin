import { expect, it } from 'vitest'
import { commitWordWrite } from '@/word/write'

// BUG: An external write landing between the final check and our publication can still be
// overwritten in that tiny window, and a read-back cannot recover a version it never observed.
// This residual race is accepted, matching other vault writes; it is not a release blocker.
it.fails(
  'does not overwrite a competing version arriving between validation and publication',
  async () => {
    const original = Uint8Array.from([1])
    const competing = Uint8Array.from([2])
    const edited = Uint8Array.from([3])
    let stored = original
    await expect(
      commitWordWrite(
        {
          read: async () => stored.slice(),
          write: async (bytes) => {
            // Another writer publishes after the read completed, before this backend publishes its write.
            stored = competing
            await Promise.resolve()
            stored = bytes
          },
        },
        original,
        edited
      )
    ).rejects.toThrow(/changed|conflict/i)
    expect(stored).toEqual(competing)
  }
)
