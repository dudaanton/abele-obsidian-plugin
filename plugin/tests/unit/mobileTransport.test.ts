import { describe, expect, it, vi } from 'vitest'
import {
  fetchViaCapacitorHttp,
  exactNativeRequestBodies,
  setNativeSyncTimeoutForTests,
} from '@/sync/mobileTransport'
import { connectionError } from '@/sync/tokenUi'
import { deferred } from '../helpers/deferred'

it('marks an aborted native commit as unknown and retries its durable key without another effect', async () => {
  const entered = deferred<void>(),
    finish = deferred<void>()
  const url = 'https://sync.example/v2/commit'
  const receipts = new Map<string, string>()
  let effects = 0
  const send = fetchViaCapacitorHttp({
    request: async (options) => {
      const key = options.headers['idempotency-key']
      if (!receipts.has(key)) {
        effects++
        receipts.set(key, '{}')
        entered.resolve()
        await finish.promise
      }
      return { status: 200, headers: {}, data: btoa(receipts.get(key)!), url }
    },
  })
  const controller = new AbortController()
  const init = { method: 'POST', headers: { 'idempotency-key': 'sample-journal-key' }, body: '{}' }
  const pending = send(url, { ...init, signal: controller.signal })
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError', outcome: 'unknown' })
  await entered.promise
  controller.abort()
  try {
    await rejected
  } finally {
    finish.resolve()
  }
  await expect(send(url, init)).resolves.toHaveProperty('status', 200)
  expect(effects).toBe(1)
})

// BUG: the native HTTP port has no cancellation handle; abort only rejects JavaScript.
it.fails('prevents a native mutation from landing after its caller aborts', async () => {
  const entered = deferred<void>(),
    finish = deferred<void>()
  const url = 'https://sync.example/v2/commit'
  let mutations = 0
  const send = fetchViaCapacitorHttp({
    request: async () => {
      entered.resolve()
      await finish.promise
      mutations++
      return { status: 200, headers: {}, data: btoa('{}'), url }
    },
  })
  const controller = new AbortController()
  const pending = send(url, { method: 'POST', body: '{}', signal: controller.signal })
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await entered.promise
  controller.abort()
  await rejected
  finish.resolve()
  await Promise.resolve()
  expect(mutations).toBe(0)
})

describe('bounded native connection-lost retry', () => {
  const url = 'https://sync.example/v2/connection'
  const lost = () =>
    Object.assign(new Error('The network connection was lost.'), { code: 'NSURLErrorDomain' })
  it.each(['GET', 'HEAD'])(
    'retries %s once after the bridge connection-lost error',
    async (method) => {
      const request = vi
        .fn()
        .mockRejectedValueOnce(lost())
        .mockResolvedValue({ status: 200, headers: {}, data: '', url })
      await expect(fetchViaCapacitorHttp({ request })(url, { method })).resolves.toHaveProperty(
        'status',
        200
      )
      expect(request).toHaveBeenCalledTimes(2)
      expect(request.mock.calls[1][0]).toEqual(request.mock.calls[0][0])
    }
  )
  it('replays a keyed commit with identical native bytes and key', async () => {
    const commit = 'https://sync.example/v2/commit'
    const seen: import('@/sync/mobileTransport').NativeHttpOptions[] = []
    const request = vi.fn(async (options: import('@/sync/mobileTransport').NativeHttpOptions) => {
      seen.push(structuredClone(options))
      if (seen.length === 1) throw lost()
      return { status: 200, headers: {}, data: btoa('{}'), url: commit }
    })
    await fetchViaCapacitorHttp(exactNativeRequestBodies({ request }))(commit, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'sample-key' },
      body: '{"ops":[],"sample":true}',
    })
    expect(seen).toHaveLength(2)
    expect(seen[1]).toEqual(seen[0])
    expect(atob(seen[1].data as string)).toBe('{"ops":[],"sample":true}')
  })
  it('snapshots the key and body before a keyed commit can be retried', async () => {
    const commit = 'https://sync.example/v2/commit'
    const init = {
      method: 'POST',
      headers: { 'idempotency-key': 'sample-original-key' },
      body: 'sample original bytes',
    }
    const request = vi.fn(async (options: import('@/sync/mobileTransport').NativeHttpOptions) => {
      if (request.mock.calls.length === 1) {
        init.headers['idempotency-key'] = 'sample-replacement-key'
        init.body = 'sample replacement bytes'
        throw lost()
      }
      return { status: 200, headers: {}, data: '', url: options.url }
    })
    await fetchViaCapacitorHttp({ request })(commit, init)
    expect(request.mock.calls[1][0].headers['idempotency-key']).toBe('sample-original-key')
    expect(request.mock.calls[1][0].data).toBe('sample original bytes')
  })
  it('does not retry an unkeyed commit or an unrelated keyed POST', async () => {
    for (const [path, headers] of [
      ['/v2/commit', {}],
      ['/v2/tokens', { 'idempotency-key': 'sample-key' }],
    ] as const) {
      const request = vi.fn().mockRejectedValue(lost())
      await expect(
        fetchViaCapacitorHttp({ request })('https://sync.example' + path, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).rejects.toThrow('Sync interrupted')
      expect(request).toHaveBeenCalledOnce()
    }
  })
  it('keeps the second connection-lost failure and never attempts a third send', async () => {
    const request = vi.fn().mockRejectedValue(lost())
    await expect(fetchViaCapacitorHttp({ request })(url)).rejects.toThrow('Sync interrupted')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('does not retry cancellation or an unrelated native error', async () => {
    for (const error of [
      new DOMException('sample abort', 'AbortError'),
      Object.assign(new Error('The request timed out.'), { code: 'NSURLErrorDomain' }),
    ]) {
      const request = vi.fn().mockRejectedValue(error)
      await expect(fetchViaCapacitorHttp({ request })(url)).rejects.toThrow()
      expect(request).toHaveBeenCalledOnce()
    }
  })
  it.each([-1005, '-1005'])('recognizes numeric connection-lost code %s', async (code) => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('sample native error'), { code }))
      .mockResolvedValue({ status: 200, headers: {}, data: '', url })
    await expect(fetchViaCapacitorHttp({ request })(new Request(url))).resolves.toHaveProperty(
      'status',
      200
    )
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('does not start a second native send when cancellation accompanies connection loss', async () => {
    const controller = new AbortController()
    const request = vi.fn(async () => {
      controller.abort()
      throw lost()
    })
    await expect(
      fetchViaCapacitorHttp({ request })(url, { signal: controller.signal })
    ).rejects.toThrow()
    expect(request).toHaveBeenCalledOnce()
  })
  it('bounds the second send and releases its timer after a late first connection loss', async () => {
    vi.useFakeTimers()
    let fail!: (error: unknown) => void
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject
          })
      )
      .mockImplementationOnce(() => new Promise(() => {}))
    try {
      const result = fetchViaCapacitorHttp({ request })(url)
      const rejected = expect(result).rejects.toThrow(
        'Native request did not answer within 30 seconds'
      )
      await vi.advanceTimersByTimeAsync(29000)
      fail(lost())
      await vi.advanceTimersByTimeAsync(30000)
      await rejected
      expect(request).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
it('rejects an oversized native range before decoding or allocating its whole body', async () => {
  const decode = vi.spyOn(window, 'atob')
  const url = 'https://sync.example/v2/files/id/content'
  const request = vi.fn(async () => ({
    url,
    status: 206,
    headers: { 'content-range': 'bytes 0-2097151/2097152' },
    data: 'A'.repeat(4 * Math.ceil((2 * 1024 * 1024) / 3)),
  }))
  try {
    await expect(
      fetchViaCapacitorHttp({ request })(url, { headers: { Range: 'bytes=0-1048575' } })
    ).rejects.toThrow('Native binary response exceeds requested range')
    expect(decode).not.toHaveBeenCalled()
  } finally {
    decode.mockRestore()
  }
})
it('bounds a stalled 8 MiB range at its size-aware deadline', async () => {
  vi.useFakeTimers()
  const request = vi.fn(() => new Promise<never>(() => {}))
  try {
    const attempt = fetchViaCapacitorHttp({ request })(
      'https://sync.example/v2/files/sample/content',
      { headers: { Range: 'bytes=0-8388607' } }
    )
    const rejected = expect(attempt).rejects.toMatchObject({
      code: 'offline',
      message: expect.stringContaining('286 seconds'),
    })
    await vi.advanceTimersByTimeAsync(286000)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
it.each(['upload', 'range'])('allows a slow 8 MiB %s beyond 30 seconds', async (kind) => {
  vi.useFakeTimers()
  const url = 'https://sync.example/v2/files/sample/content'
  const bytes = new Uint8Array(8 * 1024 * 1024)
  const request = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60000))
    return { status: 204, headers: {}, data: '', url }
  })
  try {
    const attempt = fetchViaCapacitorHttp({ request })(
      url,
      kind === 'upload' ? { method: 'PUT', body: bytes } : { headers: { Range: 'bytes=0-8388607' } }
    )
    const completed = expect(attempt).resolves.toMatchObject({ status: 204 })
    await vi.advanceTimersByTimeAsync(60000)
    await completed
  } finally {
    vi.useRealTimers()
  }
})
it('bounds a native request that never answers and ignores its late response', async () => {
  vi.useFakeTimers()
  let answer!: (response: import('@/sync/mobileTransport').NativeHttpResponse) => void
  const request = vi.fn(
    () =>
      new Promise<import('@/sync/mobileTransport').NativeHttpResponse>((resolve) => {
        answer = resolve
      })
  )
  try {
    const attempt = fetchViaCapacitorHttp({ request })('https://sync.example/v2/connection')
    const rejected = expect(attempt).rejects.toMatchObject({
      code: 'offline',
      phase: 'sending',
      message: expect.stringContaining('Sync interrupted'),
    })
    await vi.advanceTimersByTimeAsync(30000)
    await rejected
    answer({ status: 200, headers: {}, data: '', url: 'https://sync.example/v2/connection' })
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
it.each([409, 412])(
  'returns HTTP %i for a tiny native upload instead of inventing a transport failure',
  async (status) => {
    const request = vi.fn(async (options: import('@/sync/mobileTransport').NativeHttpOptions) => {
      expect(options.method).toBe('PUT')
      expect(options.url).toBe('https://sync.example/v2/uploads/' + 'a'.repeat(64))
      expect(options.headers['Content-Type']).toBe('application/octet-stream')
      expect(options.dataType).toBe('file')
      expect(atob(options.data as string)).toBe('phone edit\n')
      return { status, headers: {}, data: btoa('{}'), url: options.url }
    })
    const response = await fetchViaCapacitorHttp({ request })(
      'https://sync.example/v2/uploads/' + 'a'.repeat(64),
      { method: 'PUT', body: new TextEncoder().encode('phone edit\n') }
    )
    expect(response.status).toBe(status)
  }
)
it('reserves server unavailable for a known native connectivity failure', async () => {
  let cause: unknown
  try {
    await fetchViaCapacitorHttp({
      request: async () => {
        throw Object.assign(new Error('not connected'), { code: -1009 })
      },
    })('https://sync.example/v2/connection')
  } catch (error) {
    cause = error
  }
  expect(connectionError(cause)).toMatch(/^Server unavailable.*sending.*-1009/)
})

it('preserves sanitized native phase and cause through the core offline wrapper', async () => {
  const transport = fetchViaCapacitorHttp({
    request: async () => {
      throw Object.assign(new Error('native failed https://secret.example Bearer secret-token'), {
        code: 'E_NATIVE',
      })
    },
  })
  let cause: unknown
  try {
    await transport('https://sync.example/v2/uploads/' + 'a'.repeat(64), {
      method: 'PUT',
      body: new TextEncoder().encode('phone edit\n'),
    })
  } catch (error) {
    cause = error
  }
  expect(
    connectionError(Object.assign(new Error('never reached server'), { code: 'offline', cause }))
  ).toMatch(/Sync interrupted.*sending.*E_NATIVE/)
  expect(connectionError(cause)).not.toContain('secret')
})
it('labels unsupported bodies as pre-send failures without invoking native HTTP', async () => {
  const request = vi.fn()
  let cause: unknown
  try {
    await fetchViaCapacitorHttp({ request })('https://sync.example/v2/commit', {
      method: 'POST',
      body: new Blob(['x']),
    })
  } catch (error) {
    cause = error
  }
  expect(request).not.toHaveBeenCalled()
  expect(connectionError(cause)).toMatch(/Couldn't send changes.*encoding/)
})

describe('non-following native mobile fetch', () => {
  it('lets the engine inspect a clone before consuming the native JSON response', async () => {
    const payload = {
      protocol: 2,
      token_id: 'token',
      space_id: 'space',
      status: 'active',
      scope: { kind: 'folder', id: 'root', path: '/' },
      limits: { max_file_bytes: 1000, quota_bytes: null },
    }
    const json = JSON.stringify(payload)
    const response = await fetchViaCapacitorHttp({
      request: async (options) => ({
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': String(json.length) },
        data: btoa(json),
        url: options.url,
      }),
    })('https://sync.example/v2/connection')
    expect(await response.clone().json()).toEqual(payload)
    expect(await response.text()).toBe(JSON.stringify(payload))
    await expect(response.text()).rejects.toThrow(/consumed/)
  })
  it.each([65535, 65536, 65537])(
    'decodes %i bytes in bounded string chunks and releases native data',
    async (size) => {
      const data = 'x'.repeat(size)
      const answer = {
        status: 200,
        headers: {},
        data: btoa(data) as unknown,
        url: 'https://sync.example/bytes',
      }
      const decode = vi.spyOn(globalThis, 'atob')
      const response = await fetchViaCapacitorHttp({ request: async () => answer })(answer.url)
      expect(answer.data).toBeNull()
      expect(decode.mock.calls.every(([chunk]) => chunk.length <= 32768)).toBe(true)
      const buffer = await response.arrayBuffer()
      expect(buffer.byteLength).toBe(size)
      expect(new Uint8Array(buffer).every((byte) => byte === 120)).toBe(true)
      decode.mockRestore()
    }
  )
  it('prevents native JSON dictionary reordering from changing replay bytes', async () => {
    const seen: string[] = []
    const native = {
      request: async (options: any) => {
        // Model native JSON dictionary encoding: semantic equality is insufficient for receipts.
        const raw =
          options.dataType === 'file'
            ? atob(options.data as string)
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
  it('waits 30 s to connect and to read, unless a hung-server test lowers it', async () => {
    const seen: any[] = []
    const native = {
      request: async (opts: any) => {
        seen.push([opts.connectTimeout, opts.readTimeout])
        return { status: 200, headers: {}, data: btoa('sample'), url: opts.url }
      },
    }
    const fetch = fetchViaCapacitorHttp(native)
    await fetch('https://sync.example/timeouts')
    setNativeSyncTimeoutForTests(5000)
    try {
      await fetch('https://sync.example/timeouts')
    } finally {
      setNativeSyncTimeoutForTests(null)
    }
    await fetch('https://sync.example/timeouts')
    expect(seen).toEqual([
      [30000, 30000],
      [5000, 5000],
      [30000, 30000],
    ])
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
