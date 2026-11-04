import { afterEach, expect, it, vi } from 'vitest'
import { openResourceStream } from '@/sync/mobileResourceStream'
import { deferred } from '../helpers/deferred'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { mobileReadSnapshot } from '@/sync/mobileReadDiagnostics'
import { mobileRangeCacheFixture } from '../helpers/mobileRangeCacheFixture'
import { mobileStreamFixture } from '../helpers/mobileStreamFixture'

afterEach(() => vi.unstubAllGlobals())
const MiB = 1024 * 1024
it.each([8, 200])(
  'streams a %s MiB upload through the mobile adapter with a 2 MiB reader allocation bound',
  async (size) => {
    const f = mobileRangeCacheFixture(size * MiB)
    f.readBinary.mockImplementation(async () => {
      throw new Error('unbounded adapter read')
    })
    const io = new BoundedVaultIo(f.adapter)
    const source = await io.openUploadRead('sample.bin')
    try {
      for (let at = 0; at < f.size; at += MiB) {
        const bytes = await source.read(at, MiB)
        expect(bytes.length).toBe(MiB)
        expect(bytes[0]).toBe(73)
        expect(bytes.at(-1)).toBe(73)
      }
      const counts = mobileReadSnapshot()
      expect(counts.wholeReads).toBe(0)
      expect(counts.peakReaderBytes).toBeLessThanOrEqual(2 * MiB)
      expect(counts.maxChunkBytes).toBeLessThanOrEqual(MiB)
      expect(f.counts.largeFetches).toBe(1)
      expect(f.counts.bytesProduced).toBe(f.size)
      expect(f.counts.arrayBuffers).toBe(0)
      expect(f.counts.blobs).toBe(0)
      expect(f.native.unbounded).toBe(0)
      expect(f.native.maxBuffer).toBeLessThanOrEqual(MiB)
      expect(f.native.copies).toBe(1)
      expect(f.native.ranges).toBe(size)
      expect(f.readBinary).not.toHaveBeenCalled()
      const abort = new AbortController()
      abort.abort(new Error('sample stop'))
      await expect(source.read(0, MiB, abort.signal)).rejects.toThrow('sample stop')
    } finally {
      await source.close()
    }
    expect(mobileReadSnapshot().retainedBytes).toBe(0)
    expect(mobileReadSnapshot().activeStreams).toBe(0)
    expect(f.probes.size).toBe(0)
    expect(f.cache.size).toBe(0)
  }
)

it('serializes concurrent offsets and can rewind without retaining the file', async () => {
  const f = mobileStreamFixture(8 * MiB)
  const source = openResourceStream(f.adapter, f.fetcher, 'sample.bin', f.size)
  try {
    const chunks = await Promise.all([source.read(3 * MiB, MiB), source.read(4 * MiB, MiB)])
    expect(chunks.every((bytes) => bytes.length === MiB && bytes[0] === 73)).toBe(true)
    expect(f.counts.largeFetches).toBe(1)
    expect((await source.read(0, MiB))[0]).toBe(73)
    expect(f.counts.largeFetches).toBe(2)
    expect(f.counts.cancelled).toBe(1)
  } finally {
    await source.close()
  }
  expect(f.counts.cancelled).toBe(2)
})
it('cancels a pending resource reader before draining queued reads', async () => {
  const f = mobileStreamFixture(8 * MiB)
  const entered = deferred()
  const body = new ReadableStream<Uint8Array>(
    {
      pull: () => {
        entered.resolve()
      },
    },
    { highWaterMark: 0 }
  )
  const fetcher = vi.fn(async () => new Response(body))
  const source = openResourceStream(f.adapter, fetcher, 'sample.bin', f.size)
  const controller = new AbortController()
  let settled = false
  const reading = source.read(0, MiB, controller.signal).catch(() => {
    settled = true
  })
  try {
    await entered.promise
    controller.abort(new Error('sample stop'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(true)
  } finally {
    await source.close()
    await reading
  }
})
