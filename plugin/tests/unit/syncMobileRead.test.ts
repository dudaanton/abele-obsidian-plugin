import { afterEach, expect, it, vi } from 'vitest'
import { MAX_CHUNK_BYTES } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { mobileRangeCacheFixture } from '../helpers/mobileRangeCacheFixture'
import { mobileStreamFixture } from '../helpers/mobileStreamFixture'
import { buildFakeVault } from '../helpers/fakeVault'

afterEach(() => vi.unstubAllGlobals())

it('keeps bytes on disk when a host cannot return bounded chunks', async () => {
  const f = mobileStreamFixture(8 * MAX_CHUNK_BYTES)
  const io = new BoundedVaultIo(f.adapter)
  await expect(io.readAll('sample.bin')).rejects.toThrow('local bytes retained for retry')
  expect(f.readBinary).not.toHaveBeenCalled()
  expect(f.probes.size).toBe(0)
  expect(f.counts.bytesProduced).toBe(0)
})

it('reads retained mobile bytes in bounded native results after an interrupted read and restart', async () => {
  const f = mobileRangeCacheFixture(8 * MAX_CHUNK_BYTES + 13)
  // Model the bridge allocation before returning to JS, where a size check is too late.
  f.readBinary.mockImplementation(async () => {
    throw new Error('unbounded Filesystem.readFile result')
  })
  const app = buildFakeVault([])
  Reflect.set(app.vault, 'adapter', f.adapter)
  const fetcher = f.fetcher.getMockImplementation()!
  let interrupt = true
  f.fetcher.mockImplementation(async (input, init) => {
    if (
      interrupt &&
      new Headers(init?.headers).get('Range') ===
        `bytes=${MAX_CHUNK_BYTES}-${2 * MAX_CHUNK_BYTES - 1}`
    )
      throw new Error('sample interrupted read')
    return fetcher(input, init)
  })
  const first = new ObsidianFileSystem(app as never)
  await expect(first.read('sample.bin')).rejects.toThrow('cannot read')
  interrupt = false
  const restarted = new ObsidianFileSystem(app as never)
  const bytes = await restarted.read('sample.bin')
  expect(bytes.length).toBe(f.size)
  expect(bytes.every((byte) => byte === 73)).toBe(true)
  expect(f.native.maxBuffer).toBeLessThanOrEqual(MAX_CHUNK_BYTES)
  expect(f.native.unbounded).toBe(0)
  expect(f.readBinary).not.toHaveBeenCalled()
  expect(f.cache.size).toBe(0)
})
