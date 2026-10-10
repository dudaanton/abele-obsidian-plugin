import { expect, it, vi } from 'vitest'
import { rangedBinaryTransport } from '@/sync/rangedBinaryTransport'
import { fetchViaCapacitorHttp } from '@/sync/mobileTransport'

it('retries a stalled native range within 65s without downloading completed ranges again', async () => {
  vi.useFakeTimers()
  const chunk = 1024 * 1024,
    ranges: string[] = []
  const request = vi.fn(async (options) => {
    ranges.push(options.headers.range)
    if (ranges.length === 2) return new Promise<never>(() => {})
    const start = Number(/^bytes=(\d+)/.exec(options.headers.range)![1])
    return {
      status: 206,
      url: options.url,
      data: btoa('x'.repeat(chunk)),
      headers: { 'content-range': `bytes ${start}-${start + chunk - 1}/${2 * chunk}` },
    }
  })
  try {
    const transfer = rangedBinaryTransport(
      fetchViaCapacitorHttp({ request }),
      chunk
    )('https://sync.example/v2/files/sample/content')
    const result = transfer.then((response) => response.arrayBuffer())
    await vi.advanceTimersByTimeAsync(65000)
    expect(ranges).toEqual(['bytes=0-1048575', 'bytes=1048576-2097151', 'bytes=1048576-2097151'])
    expect((await result).byteLength).toBe(2 * chunk)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('allows a slow progressing multi-range download to exceed a single range deadline', async () => {
  vi.useFakeTimers()
  const chunk = 1024 * 1024
  const request = vi.fn(async (options) => {
    await new Promise((resolve) => window.setTimeout(resolve, 60000))
    const start = Number(/^bytes=(\d+)/.exec(options.headers.range)![1])
    return {
      status: 206,
      url: options.url,
      data: btoa('x'.repeat(chunk)),
      headers: { 'content-range': `bytes ${start}-${start + chunk - 1}/${2 * chunk}` },
    }
  })
  try {
    const transfer = rangedBinaryTransport(
      fetchViaCapacitorHttp({ request }),
      chunk
    )('https://sync.example/v2/files/sample/content')
    await vi.advanceTimersByTimeAsync(120000)
    expect((await (await transfer).arrayBuffer()).byteLength).toBe(2 * chunk)
    expect(request).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('does not issue a retry after disconnect aborts during the range backoff', async () => {
  vi.useFakeTimers()
  const abort = new AbortController()
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValue(Object.assign(new Error('interrupted'), { code: 'offline' }))
  try {
    const result = rangedBinaryTransport(send, 1024 * 1024)(
      'https://sync.example/v2/files/sample/content',
      { signal: abort.signal }
    ).catch((error) => error)
    await vi.advanceTimersByTimeAsync(1)
    abort.abort()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(send).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
