import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'

it('inspects the prefix of a 200 MiB file without a whole-file adapter read', async () => {
  const readBinary = vi.fn(() => {
    throw new Error('whole-file read')
  })
  const close = vi.fn(async () => {})
  const read = vi.fn(async () => new Uint8Array([80, 75, 3, 4]))
  const fs = Object.assign(Object.create(ObsidianFileSystem.prototype), {
    rawStat: async () => ({ type: 'file', size: 200 * 1024 * 1024 }),
    io: {
      openRead: async () => ({
        size: 200 * 1024 * 1024,
        read,
        close,
        assertUnchanged: async () => {},
      }),
    },
  }) as ObsidianFileSystem
  Object.defineProperty(fs, 'disk', { value: { readBinary } })
  expect(await fs.readPrefix('sample.epub', 4)).toEqual(new Uint8Array([80, 75, 3, 4]))
  expect(read).toHaveBeenCalledWith(0, 4)
  expect(close).toHaveBeenCalledOnce()
  expect(readBinary).not.toHaveBeenCalled()
})
