import { expect, it, vi } from 'vitest'
import { binaryRangeChunks } from '@/sync/rangedBinaryTransport'
import { binaryResponse } from '@/sync/binaryResponse'

it('backpressures a virtual 3 GiB file with at most two 1 MiB application buffers live', async () => {
  const cap = 1024 * 1024,
    total = 3 * 1024 ** 3
  let live = 0,
    peak = 0,
    requests = 0
  const buffers = new Map<object, number>(),
    Original = Uint8Array
  vi.stubGlobal(
    'Uint8Array',
    new Proxy(Original, {
      construct(Type, args) {
        const bytes = Reflect.construct(Type, args) as Uint8Array
        if (bytes.byteLength > cap) throw new Error('oversized application buffer')
        buffers.set(bytes.buffer, bytes.buffer.byteLength)
        live = [...buffers.values()].reduce((sum, value) => sum + value, 0)
        peak = Math.max(peak, live)
        return bytes
      },
    })
  )
  try {
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range')!)!
      const start = Number(range[1]),
        end = Math.min(Number(range[2]), total - 1)
      const length = end - start + 1
      if (length > cap) throw new Error('oversized transport buffer')
      requests++
      const response = binaryResponse(new Uint8Array(length), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${total}` },
      })
      response.arrayBuffer = async () => {
        throw new Error('whole-body buffering is forbidden')
      }
      return response
    })
    let consumed = 0
    for await (const chunk of binaryRangeChunks(send, 'https://sync.example/v2/files/id/content')) {
      expect(chunk.bytes.length).toBeLessThanOrEqual(cap)
      // A slow staging append is awaited before any next request is issued.
      const before = requests
      await Promise.resolve()
      expect(requests).toBe(before)
      consumed += chunk.bytes.length
      buffers.clear()
      live = 0
    }
    expect(consumed).toBe(total)
    expect(peak).toBeLessThanOrEqual(2 * cap)
    expect(live).toBe(0)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('rejects an ignored range without reading its whole body', async () => {
  const response = new Response(
    new ReadableStream(
      {
        pull() {
          throw new Error('body touched')
        },
      },
      { highWaterMark: 0 }
    ),
    { status: 200 }
  )
  const send = vi.fn<typeof fetch>(async () => response)
  await expect(
    binaryRangeChunks(send, 'https://sync.example/v2/files/id/content').next()
  ).rejects.toThrow('Server ignored the binary range')
  expect(send).toHaveBeenCalledOnce()
})

it('cancels without fetching ahead when the consumer stops', async () => {
  const abort = new AbortController(),
    cap = 1024 * 1024
  const send = vi.fn<typeof fetch>(async () =>
    binaryResponse(new Uint8Array(cap), {
      status: 206,
      headers: { 'content-range': `bytes 0-${cap - 1}/${2 * cap}` },
    })
  )
  const chunks = binaryRangeChunks(send, 'https://sync.example/v2/files/id/content', {
    signal: abort.signal,
  })
  await chunks.next()
  abort.abort()
  await expect(chunks.next()).rejects.toMatchObject({ name: 'AbortError' })
  expect(send).toHaveBeenCalledOnce()
})

it('settles cancellation during a stalled range body read', async () => {
  const abort = new AbortController()
  const stalled = vi.fn(() => new Promise<void>(() => {}))
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response(new ReadableStream({ pull: stalled }, { highWaterMark: 0 }), {
        status: 206,
        headers: { 'content-range': 'bytes 0-0/1' },
      })
  )
  const pending = binaryRangeChunks(send, 'https://sync.example/v2/files/id/content', {
    signal: abort.signal,
  }).next()
  await vi.waitFor(() => expect(stalled).toHaveBeenCalledOnce())
  abort.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})
