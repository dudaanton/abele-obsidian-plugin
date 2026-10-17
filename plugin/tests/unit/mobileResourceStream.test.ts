import { afterEach, expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { MAX_CHUNK_BYTES } from '@abele/sync-core'
import { resourceStream } from '@/sync/mobileResourceStream'
import { mobileReadSnapshot } from '@/sync/mobileReadDiagnostics'

afterEach(() => vi.useRealTimers())
const adapter = {
  getResourcePath: (path: string) => 'capacitor://localhost/_capacitor_file_/sample/' + path,
} as DataAdapter
function fixture(size: number, chunk = 65536) {
  let produced = 0,
    cancelled = 0
  const fetcher = vi.fn(async () => {
    let at = 0
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (at === size) {
              controller.close()
              return
            }
            const length = Math.min(chunk, size - at)
            controller.enqueue(Uint8Array.from({ length }, (_, i) => (at + i) % 251))
            at += length
            produced += length
          },
          cancel() {
            cancelled++
          },
        },
        { highWaterMark: 0 }
      )
    )
    response.arrayBuffer = async () => {
      throw new Error('whole body')
    }
    response.blob = async () => {
      throw new Error('whole body')
    }
    return response
  })
  return {
    fetcher,
    counts: () => ({ produced, cancelled }),
    open: () => resourceStream(adapter, fetcher, 'sample.bin', size),
  }
}
const expected = (at: number, length: number) =>
  Uint8Array.from({ length }, (_, i) => (at + i) % 251)

it('streams and skips forward, reopens for a backward seek, and serializes overlapping reads', async () => {
  const f = fixture(3 * MAX_CHUNK_BYTES + 5),
    source = f.open()
  try {
    expect(await source.read(MAX_CHUNK_BYTES + 7, 23)).toEqual(expected(MAX_CHUNK_BYTES + 7, 23))
    expect(await source.read(0, 13)).toEqual(expected(0, 13))
    const [a, b] = await Promise.all([source.read(13, 19), source.read(32, 7)])
    expect(a).toEqual(expected(13, 19))
    expect(b).toEqual(expected(32, 7))
    expect(f.fetcher).toHaveBeenCalledTimes(2)
    expect(f.counts().produced).toBeLessThan(2 * MAX_CHUNK_BYTES)
    expect(mobileReadSnapshot().peakReaderBytes).toBeLessThanOrEqual(2 * MAX_CHUNK_BYTES)
  } finally {
    await source.close()
  }
  expect(f.counts().cancelled).toBe(2)
  expect(mobileReadSnapshot().retainedBytes).toBe(0)
})

it('rejects a truncated or overlong resource and releases the body', async () => {
  for (const size of [7, 9]) {
    const f = fixture(size)
    const source = resourceStream(adapter, f.fetcher, 'sample.bin', 8)
    await expect(source.read(0, 8)).rejects.toThrow(size === 7 ? 'Truncated' : 'Invalid')
    await source.close()
  }
  expect(mobileReadSnapshot().activeStreams).toBe(0)
  expect(mobileReadSnapshot().retainedBytes).toBe(0)
})

it.each(['abort', 'close', 'timeout'])(
  'settles a stalled stream on %s and cancels its reader',
  async (action) => {
    if (action === 'timeout') vi.useFakeTimers()
    let started!: () => void
    const pulling = new Promise<void>((resolve) => {
      started = resolve
    })
    const cancel = vi.fn()
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull() {
                started()
                return new Promise<void>(() => {})
              },
              cancel,
            },
            { highWaterMark: 0 }
          )
        )
    )
    const source = resourceStream(adapter, fetcher, 'sample.bin', 8),
      controller = new AbortController()
    const flight = source.read(0, 8, controller.signal)
    const rejected = expect(flight).rejects.toThrow()
    await pulling
    if (action === 'abort') controller.abort(new Error('sample cancellation'))
    else if (action === 'close') await source.close()
    else await vi.advanceTimersByTimeAsync(30001)
    await rejected
    await source.close()
    expect(cancel).toHaveBeenCalledOnce()
    expect(mobileReadSnapshot().activeStreams).toBe(0)
    expect(mobileReadSnapshot().retainedBytes).toBe(0)
  }
)

it('cancels a response when ownership is lost while fetching its headers', async () => {
  let owned = true
  const cancel = vi.fn()
  const source = resourceStream(
    adapter,
    async () => {
      owned = false
      return new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }))
    },
    'sample.bin',
    8,
    () => {
      if (!owned) throw new Error('ownership lost')
    }
  )
  await expect(source.read(0, 8)).rejects.toThrow('ownership lost')
  await source.close()
  expect(cancel).toHaveBeenCalledOnce()
})

it('refuses invalid reads without issuing requests', async () => {
  const f = fixture(8),
    source = f.open()
  for (const [at, length] of [
    [-1, 1],
    [0, MAX_CHUNK_BYTES + 1],
    [7, 2],
    [0, 0.5],
  ])
    await expect(source.read(at, length)).rejects.toThrow('Invalid')
  expect(await source.read(0, 0)).toEqual(new Uint8Array())
  await source.close()
  await expect(source.read(0, 1)).rejects.toThrow('Invalid')
  expect(f.fetcher).not.toHaveBeenCalled()
})

it('records a large backing buffer while returning only the requested bytes', async () => {
  const bytes = new Uint8Array(MAX_CHUNK_BYTES + 1)
  const cancel = vi.fn()
  const source = resourceStream(
    adapter,
    async () =>
      new Response(
        new ReadableStream(
          {
            pull(controller) {
              controller.enqueue(bytes.subarray(0, 8))
              controller.close()
            },
            cancel,
          },
          { highWaterMark: 0 }
        )
      ),
    'sample.bin',
    8
  )
  expect(await source.read(0, 8)).toEqual(new Uint8Array(8))
  await source.close()
  expect(cancel).not.toHaveBeenCalled()
  expect(mobileReadSnapshot().oversizedChunks).toBe(1)
  expect(mobileReadSnapshot().maxChunkBytes).toBe(MAX_CHUNK_BYTES + 1)
  expect(mobileReadSnapshot().retainedBytes).toBe(0)
})

// The local resource bridge may deliver a complete file as one chunk.
it.each([0, 200])(
  'accepts local status %s without headers and bounds outputs from a large delivery',
  async (status) => {
    const size = 8 * MAX_CHUNK_BYTES + 7
    const f = fixture(size, size)
    const source = resourceStream(
      adapter,
      async () => {
        const response = await f.fetcher()
        Object.defineProperty(response, 'status', { value: status })
        Object.defineProperty(response, 'headers', { value: undefined })
        return response
      },
      'sample.bin',
      size
    )
    try {
      for (let at = 0; at < size; at += MAX_CHUNK_BYTES) {
        const length = Math.min(MAX_CHUNK_BYTES, size - at)
        const bytes = await source.read(at, length)
        expect(bytes.length).toBe(length)
        expect(bytes.every((byte, i) => byte === (at + i) % 251)).toBe(true)
      }
      expect(f.fetcher).toHaveBeenCalledOnce()
      expect(f.counts().produced).toBe(size)
    } finally {
      await source.close()
    }
    expect(mobileReadSnapshot().retainedBytes).toBe(0)
  }
)
it('validates the body length rather than a stale local content-length header', async () => {
  const f = fixture(8)
  const source = resourceStream(
    adapter,
    async () => {
      const response = await f.fetcher()
      response.headers.set('Content-Length', '0')
      return response
    },
    'sample.bin',
    8
  )
  try {
    expect(await source.read(0, 8)).toEqual(expected(0, 8))
  } finally {
    await source.close()
  }
})
