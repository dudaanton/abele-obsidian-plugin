import { expect, it } from 'vitest'
import { commitWordWrite } from '@/word/write'

// BUG: Read/write cannot provide compare-and-swap against an uncoordinated external writer.
// The public Obsidian adapter has no conditional binary write; this remains a release blocker.
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
