import { afterEach, expect, it, vi } from 'vitest'
import { browserUploadTransport, supportsBrowserUploads } from '@/sync/browserUploadTransport'
import { mobileTransport } from '@/sync/mobileTransport'
import { createServer } from 'node:http'

afterEach(() => vi.unstubAllGlobals())

const origin = 'https://sync.example'
const part = '/v2/uploads/' + 'a'.repeat(64) + '/sample-session/0'
const headers = { Authorization: 'Bearer synthetic-token' }
const body = new Uint8Array(1024)
function response(url: string, value?: unknown, status = 200) {
  const result = new Response(value === undefined ? null : JSON.stringify(value), { status })
  Object.defineProperty(result, 'url', { value: url })
  return result
}
function fixture(capability: unknown = true, browserAvailable = true) {
  const native = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    return response(
      url,
      url.endsWith('/v2/connection') ? { browserUploads: capability } : undefined
    )
  })
  const browser = vi.fn(async (input: RequestInfo | URL) => response(String(input), undefined, 204))
  return {
    native,
    browser,
    send: browserUploadTransport(native, browserAvailable ? browser : undefined),
  }
}
it.each([true])(
  'selects original browser fetch only after advertisement: %j',
  async (capability) => {
    const f = fixture(capability)
    await f.send(origin + '/v2/connection', { headers })
    const signal = new AbortController().signal
    await f.send(origin + part, {
      method: 'PUT',
      headers,
      body,
      signal,
      redirect: 'follow',
      credentials: 'include',
    })
    expect(f.native).toHaveBeenCalledOnce()
    expect(f.browser).toHaveBeenCalledExactlyOnceWith(
      origin + part,
      expect.objectContaining({
        body,
        signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
      })
    )
  }
)
it.each([undefined, false, {}, { enabled: false }, { enabled: true }, 'true'])(
  'keeps old/unknown capabilities on native: %j',
  async (capability) => {
    const f = fixture(capability === undefined ? null : capability)
    await f.send(origin + '/v2/connection', { headers })
    await f.send(origin + part, { method: 'PUT', headers, body })
    expect(f.browser).not.toHaveBeenCalled()
    expect(f.native).toHaveBeenCalledTimes(2)
  }
)
it('uses native when the original browser function is absent', async () => {
  const f = fixture(true, false)
  await f.send(origin + '/v2/connection', { headers })
  await f.send(origin + part, { method: 'PUT', headers, body })
  expect(f.native).toHaveBeenCalledTimes(2)
})
it('does not share capability across origins or principals and does not consume the connection body', async () => {
  const f = fixture()
  const info = await f.send(origin + '/v2/connection', { headers })
  // The transport extension must not reach the pinned SDK's strict connection schema.
  expect(await info.json()).toEqual({})
  await f.send('https://other.example' + part, { method: 'PUT', headers, body })
  await f.send(origin + part, {
    method: 'PUT',
    body,
    headers: { Authorization: 'Bearer another-token' },
  })
  expect(f.browser).not.toHaveBeenCalled()
})
it('does not transfer a capability to another scoped item', async () => {
  const f = fixture()
  await f.send(origin + '/v2/connection', { headers: { ...headers, 'abele-scope-item': 'first' } })
  await f.send(origin + part, {
    method: 'PUT',
    body,
    headers: { ...headers, 'abele-scope-item': 'second' },
  })
  expect(f.browser).not.toHaveBeenCalled()
})
it.each([
  { method: 'POST', path: part, body },
  { method: 'PUT', path: '/v2/uploads/' + 'a'.repeat(64), body },
  { method: 'PUT', path: part + '/complete', body },
  { method: 'PUT', path: part, body: 'text' },
  { method: 'PUT', path: part, body: new Uint8Array(1024 * 1024 + 1) },
])('restricts selection to bounded binary part PUTs: $method $path', async (request) => {
  const f = fixture()
  await f.send(origin + '/v2/connection', { headers })
  await f.send(origin + request.path, { ...request, headers })
  expect(f.browser).not.toHaveBeenCalled()
})
it('never falls back to native when browser fetch rejects a redirect or network failure', async () => {
  const f = fixture()
  await f.send(origin + '/v2/connection', { headers })
  f.browser.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await expect(f.send(origin + part, { method: 'PUT', headers, body })).rejects.toMatchObject({
    code: 'offline',
  })
  expect(f.native).toHaveBeenCalledOnce()
  expect(f.browser).toHaveBeenCalledOnce()
  // The SDK may retry this idempotent part after reconciling its session.
  await f.send(origin + part, { method: 'PUT', headers, body })
  expect(f.browser).toHaveBeenCalledTimes(2)
  expect(f.native).toHaveBeenCalledOnce()
})
it.each([origin + '/different', 'https://other.example/sink'])(
  'fails closed on a changed final URL: %s',
  async (url) => {
    const f = fixture()
    await f.send(origin + '/v2/connection', { headers })
    f.browser.mockResolvedValueOnce(response(url))
    await expect(f.send(origin + part, { method: 'PUT', headers, body })).rejects.toMatchObject({
      code: 'io',
    })
    expect(f.native).toHaveBeenCalledOnce()
  }
)
it('preserves abort before submission and during browser upload without native fallback', async () => {
  const f = fixture()
  await f.send(origin + '/v2/connection', { headers })
  const controller = new AbortController()
  controller.abort()
  await expect(
    f.send(origin + part, { method: 'PUT', headers, body, signal: controller.signal })
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(f.browser).not.toHaveBeenCalled()
  const pending = new AbortController()
  f.browser.mockImplementationOnce(
    (_input, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        )
      })
  )
  const send = f.send(origin + part, { method: 'PUT', headers, body, signal: pending.signal })
  const rejected = expect(send).rejects.toMatchObject({ name: 'AbortError' })
  pending.abort()
  await rejected
  expect(f.native).toHaveBeenCalledOnce()
})
it('revokes a previously advertised capability on refresh', async () => {
  const f = fixture()
  await f.send(origin + '/v2/connection', { headers })
  f.native.mockResolvedValueOnce(response(origin + '/v2/connection', {}))
  await f.send(origin + '/v2/connection', { headers })
  await f.send(origin + part, { method: 'PUT', headers, body })
  expect(f.browser).not.toHaveBeenCalled()
})
it('accepts only the negotiated literal-true capability', () => {
  expect(supportsBrowserUploads({ browserUploads: true })).toBe(true)
  // The finalized server contract emits literal true, never the provisional object form.
  expect(supportsBrowserUploads({ browserUploads: { enabled: true } })).toBe(false)
  expect(supportsBrowserUploads(null)).toBe(false)
})

it.each([false, true])(
  'negotiates on connection discovery and preserves capability tokens (Request=%s)',
  async (asRequest) => {
    const f = fixture()
    const init = { headers: { ...headers, 'abele-client-capabilities': 'existing, another' } }
    const input = origin + '/v2/connection'
    if (asRequest) await f.send(new Request(input, init))
    else await f.send(input, init)
    const sent = f.native.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    expect(new Headers(sent[1].headers).get('abele-client-capabilities')).toBe(
      'existing, another, browserUploads'
    )
    expect(new Headers(sent[1].headers).get('authorization')).toBe(headers.Authorization)
    expect(init.headers['abele-client-capabilities']).toBe('existing, another')
  }
)

it('does not duplicate the exact capability or advertise it on unrelated requests', async () => {
  const f = fixture()
  await f.send(origin + '/v2/connection', {
    headers: { ...headers, 'abele-client-capabilities': 'browseruploads, browserUploads' },
  })
  const sent = f.native.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
  expect(new Headers(sent[1].headers).get('abele-client-capabilities')).toBe(
    'browseruploads, browserUploads'
  )
  await f.send(origin + '/v2/other', { headers })
  expect(f.native.mock.calls[1]).toEqual([origin + '/v2/other', { headers }])
})

it.each([true, false])(
  'removes only its transport extension before strict SDK parsing (browser=%s)',
  async (available) => {
    const native = vi.fn(async () =>
      response(origin + '/v2/connection', {
        browserUploads: true,
        protocol: 2,
        unexpectedProtocolKey: 'still visible to validation',
      })
    )
    const send = browserUploadTransport(native, available ? fixture().browser : undefined)
    const result = await send(origin + '/v2/connection', { headers })
    expect(await result.json()).toEqual({
      protocol: 2,
      unexpectedProtocolKey: 'still visible to validation',
    })
  }
)

it('wires the captured original fetch into the real mobile adapter without using patched fetch', async () => {
  const native = vi.fn(async (options) => ({
    status: 200,
    headers: {},
    data: { browserUploads: true },
    url: options.url,
  }))
  const original = vi.fn(function (this: unknown, input: RequestInfo | URL) {
    expect(this).toBe(window)
    return Promise.resolve(response(String(input), undefined, 204))
  })
  const patched = vi.fn(async () => {
    throw new Error('patched fetch must not be used')
  })
  vi.stubGlobal('Capacitor', {
    getPlatform: () => 'ios',
    Plugins: { CapacitorHttp: { request: native } },
  })
  vi.stubGlobal('CapacitorWebFetch', original)
  vi.stubGlobal('fetch', patched)
  const send = mobileTransport()
  await send(origin + '/v2/connection', { headers })
  // Runtime replacement must not change the captured browser port mid-session.
  vi.stubGlobal('CapacitorWebFetch', patched)
  await send(origin + part, { method: 'PUT', headers, body })
  expect(native).toHaveBeenCalledOnce()
  expect(original).toHaveBeenCalledOnce()
  expect(patched).not.toHaveBeenCalled()
})

it.each([307, 308])(
  'browser redirect:error delivers zero bytes to an actual %s redirect sink',
  async (status) => {
    let sinkBytes = 0
    let chosenBytes = 0
    const server = createServer((request, reply) => {
      reply.setHeader('Access-Control-Allow-Origin', '*')
      reply.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS')
      reply.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
      if (request.method === 'OPTIONS') {
        reply.writeHead(204).end()
        return
      }
      if (request.url === '/sink') {
        request.on('data', (chunk) => {
          sinkBytes += chunk.length
        })
        request.on('end', () => {
          reply.writeHead(204).end()
        })
      } else {
        request.on('data', (chunk) => {
          chosenBytes += chunk.length
        })
        request.on('end', () => {
          reply.writeHead(status, { Location: '/sink' }).end()
        })
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected fixture listener')
      const base = `http://127.0.0.1:${address.port}`
      const native = vi.fn(async (input: RequestInfo | URL) =>
        response(String(input), { browserUploads: true })
      )
      const send = browserUploadTransport(native, window.fetch.bind(window))
      await send(base + '/v2/connection', { headers })
      await expect(send(base + part, { method: 'PUT', headers, body })).rejects.toMatchObject({
        code: 'offline',
      })
      expect(chosenBytes).toBe(body.byteLength)
      expect(sinkBytes).toBe(0)
      expect(native).toHaveBeenCalledOnce()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
)
