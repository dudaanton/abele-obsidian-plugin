import { describe, expect, it, vi } from 'vitest'
import { fetchViaCapacitorHttp, exactNativeRequestBodies } from '@/sync/mobileTransport'

describe('non-following native mobile fetch', () => {
  it('prevents native JSON dictionary reordering from changing replay bytes', async () => {
    const seen: string[] = []
    const native = {
      request: async (options: any) => {
        // Model native JSON dictionary encoding: semantic equality is insufficient for receipts.
        const raw =
          options.dataType === 'file'
            ? atob(options.data)
            : JSON.stringify(options.data, Object.keys(options.data).sort())
        seen.push(raw)
        return { status: 200, headers: {}, data: btoa(raw), url: options.url }
      },
    }
    const fetch = fetchViaCapacitorHttp(exactNativeRequestBodies(native))
    for (let i = 0; i < 2; i++)
      await fetch('https://sync.example/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"z":1,"a":2}',
      })
    expect(seen).toEqual(['{"z":1,"a":2}', '{"z":1,"a":2}'])
  })
  it.each([301, 307, 308])(
    'requests pre-follow refusal for %s, never sends to the sink',
    async (status) => {
      const native = {
        request: vi.fn(async (opts: any) => {
          expect(opts.disableRedirects).toBe(true)
          return {
            status,
            headers: { Location: 'https://other.example/sink' },
            data: btoa('redirect'),
            url: opts.url,
          }
        }),
      }
      const fetch = fetchViaCapacitorHttp(native)
      await expect(
        fetch('https://sync.example/redirect', {
          method: 'POST',
          headers: { authorization: 'Bearer sample' },
          body: 'sample-password',
        })
      ).rejects.toThrow(/redirect/)
      expect(native.request).toHaveBeenCalledTimes(1)
    }
  )
  it('disables cache for GET as well as HEAD across principal switches', async () => {
    const seen: any[] = []
    const native = {
      request: async (opts: any) => {
        seen.push(opts)
        return {
          status: opts.headers.authorization === 'Bearer first' ? 200 : 403,
          headers: {},
          data: btoa('sample'),
          url: opts.url,
        }
      },
    }
    const fetch = fetchViaCapacitorHttp(native)
    for (const method of ['GET', 'HEAD'])
      for (const principal of ['first', 'second', 'first'])
        await fetch('https://sync.example/cache', {
          method,
          headers: { authorization: 'Bearer ' + principal },
        })
    expect(seen.map((o) => o.headers['Cache-Control'])).toEqual(Array(6).fill('no-cache, no-store'))
  })
  it('encodes binary file bytes exactly and preserves explicit text/JSON bodies', async () => {
    const request = vi.fn(async (opts: any) => ({
      status: 200,
      headers: {},
      data:
        opts.dataType === 'file'
          ? opts.data
          : btoa(typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data)),
      url: opts.url,
    }))
    const fetch = fetchViaCapacitorHttp({ request })
    const binary = await fetch('https://sync.example/bytes', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array([0, 255, 1, 128]),
    })
    expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([0, 255, 1, 128])
    expect(request.mock.calls[0][0]).toMatchObject({
      data: 'AP8BgA==',
      dataType: 'file',
      headers: { 'Content-Type': 'application/octet-stream' },
      responseType: 'arraybuffer',
    })
    await fetch('https://sync.example/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"sample":"value"}',
    })
    expect(request.mock.calls[1][0]).toMatchObject({
      data: { sample: 'value' },
      headers: { 'Content-Type': 'application/json' },
    })
    await fetch('https://sync.example/text', { method: 'POST', body: 'sample-password' })
    expect(request.mock.calls[2][0]).toMatchObject({
      data: 'sample-password',
      headers: { 'Content-Type': 'text/plain' },
    })
  })
  it('refuses already-aborted work before native request, and fences an in-flight result', async () => {
    const request = vi.fn(async (opts: any) => ({
      status: 200,
      headers: {},
      data: btoa('ok'),
      url: opts.url,
    }))
    const fetch = fetchViaCapacitorHttp({ request })
    const abort = new AbortController()
    abort.abort()
    await expect(fetch('https://sync.example/a', { signal: abort.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(request).not.toHaveBeenCalled()
    let answer!: (v: any) => void
    const pending = fetchViaCapacitorHttp({
      request: () =>
        new Promise((r) => {
          answer = r
        }),
    })
    const active = new AbortController(),
      result = pending('https://sync.example/a', { signal: active.signal })
    await Promise.resolve() // The native operation must actually be in flight before abort.
    expect(answer).toBeTypeOf('function')
    active.abort()
    answer({ status: 200, headers: {}, data: btoa('ok'), url: 'https://sync.example/a' })
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })
})
