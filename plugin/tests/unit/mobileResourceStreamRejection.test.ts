import { afterEach, expect, it, vi } from 'vitest'
import { openResourceStream } from '@/sync/mobileResourceStream'
import { mobileStreamFixture } from '../helpers/mobileStreamFixture'
afterEach(() => vi.unstubAllGlobals())
const MiB = 1024 * 1024
// A deliberately oversized input must not contaminate accepted-reader lifetime peaks.
it('refuses a large backing buffer instead of accepting a small view of the whole file', async () => {
  const f = mobileStreamFixture(8 * MiB)
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => controller.enqueue(new Uint8Array(2 * MiB).subarray(0, 64)),
  })
  const source = openResourceStream(f.adapter, async () => new Response(body), 'sample.bin', f.size)
  try {
    await expect(source.read(0, 64)).rejects.toThrow('bounded chunk')
  } finally {
    await source.close()
  }
})
