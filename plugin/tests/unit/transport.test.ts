/**
 * The engine's `fetch`, built on Obsidian's `requestUrl`.
 *
 * The engine only ever sees a `Response`, so what matters here is that the two sides of the
 * translation hold: what a request carries reaches `requestUrl` unchanged, and what comes
 * back reads like an answer to a `fetch` — status, headers, bytes or text — including for
 * the answers that carry nothing at all.
 */
import { describe, it, expect } from 'vitest'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { fetchViaRequestUrl, wsFor, type RequestUrlFn } from '@/sync/transport'

/** An answer, with the parts a caller does not care about filled in. */
const answer = (over: Partial<RequestUrlResponse> = {}): RequestUrlResponse => ({
  status: 200,
  headers: {},
  arrayBuffer: new ArrayBuffer(0),
  json: null,
  text: '',
  ...over,
})

/** Bytes as `requestUrl` hands them back. */
const bufferOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

/** A fake `requestUrl` that records what it was asked and answers what it was told to. */
function fake(reply: (request: RequestUrlParam) => RequestUrlResponse | Promise<never>): {
  fetch: typeof fetch
  seen: RequestUrlParam[]
} {
  const seen: RequestUrlParam[] = []
  const requestUrl: RequestUrlFn = async (request) => {
    seen.push(request)
    return reply(request)
  }
  return { fetch: fetchViaRequestUrl(requestUrl), seen }
}

describe('fetchViaRequestUrl', () => {
  it('sends a GET with no body and reads the answer back', async () => {
    const { fetch, seen } = fake(() =>
      answer({ status: 200, arrayBuffer: bufferOf('{"ok":true}') })
    )

    const response = await fetch('https://sync.example/v1/vaults')

    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://sync.example/v1/vaults')
    expect(seen[0].method).toBe('GET')
    expect(seen[0].body).toBeUndefined()
    // Never Obsidian's own throwing: a 4xx is an answer the engine reads, not a failure.
    expect(seen[0].throw).toBe(false)
    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('sends a POST with its json body and content type', async () => {
    const { fetch, seen } = fake(() =>
      answer({ status: 201, arrayBuffer: bufferOf('{"id":"v1"}') })
    )

    const response = await fetch('https://sync.example/v1/vaults', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer abst_x' },
      body: JSON.stringify({ name: 'Notes' }),
    })

    expect(seen[0].method).toBe('POST')
    expect(seen[0].body).toBe('{"name":"Notes"}')
    expect(seen[0].headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer abst_x',
    })
    // Obsidian takes the content type twice over, and some builds read only this one.
    expect(seen[0].contentType).toBe('application/json')
    expect(response.status).toBe(201)
  })

  it('sends a Uint8Array body as an ArrayBuffer of exactly those bytes', async () => {
    const { fetch, seen } = fake(() => answer({ status: 201 }))
    const whole = new Uint8Array([1, 2, 3, 4, 5, 6])

    await fetch('https://sync.example/v1/blobs/abc', {
      method: 'PUT',
      body: whole,
      headers: { 'content-type': 'application/octet-stream' },
    })

    expect(seen[0].method).toBe('PUT')
    expect(seen[0].body).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(seen[0].body as ArrayBuffer)).toEqual(whole)
  })

  it('sends only the window a view covers, not the buffer behind it', async () => {
    const { fetch, seen } = fake(() => answer({ status: 201 }))
    // What a multipart upload sends: one part of a file already in memory.
    const part = new Uint8Array([1, 2, 3, 4, 5, 6]).subarray(2, 5)

    await fetch('https://sync.example/v1/blobs/abc/upload/u1/0', { method: 'PUT', body: part })

    expect(new Uint8Array(seen[0].body as ArrayBuffer)).toEqual(new Uint8Array([3, 4, 5]))
  })

  it('sends a HEAD and answers it with no body', async () => {
    const { fetch, seen } = fake(() =>
      // Obsidian hands back whatever it has; a HEAD has no body to read either way.
      answer({ status: 404, arrayBuffer: bufferOf('not this') })
    )

    const response = await fetch('https://sync.example/v1/blobs/abc', { method: 'HEAD' })

    expect(seen[0].method).toBe('HEAD')
    expect(seen[0].body).toBeUndefined()
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })

  it('round-trips the status and reads a header back whatever its case', async () => {
    const { fetch } = fake(() =>
      answer({
        status: 409,
        headers: { 'Idempotent-Replayed': 'true' },
        arrayBuffer: bufferOf('x'),
      })
    )

    const response = await fetch('https://sync.example/v1/vaults/v1/commit', { method: 'POST' })

    expect(response.status).toBe(409)
    expect(response.ok).toBe(false)
    expect(response.headers.get('idempotent-replayed')).toBe('true')
    expect(response.headers.get('Idempotent-Replayed')).toBe('true')
  })

  it('answers a 204 with an empty body rather than refusing to build one', async () => {
    const { fetch } = fake(() => answer({ status: 204, arrayBuffer: bufferOf('ignored') }))

    const response = await fetch('https://sync.example/v1/devices/d1', { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('takes headers as a Headers object and as pairs', async () => {
    const { fetch, seen } = fake(() => answer())

    await fetch('https://sync.example/a', { headers: new Headers({ Authorization: 'Bearer x' }) })
    await fetch('https://sync.example/b', { headers: [['Authorization', 'Bearer y']] })

    expect(seen[0].headers).toEqual({ authorization: 'Bearer x' })
    expect(seen[1].headers).toEqual({ authorization: 'Bearer y' })
  })

  it('rejects when the request never reached the server', async () => {
    const { fetch } = fake(() => Promise.reject(new Error('net::ERR_CONNECTION_REFUSED')))

    // The engine reads a rejected fetch as being offline; anything else would be read as
    // an answer from a server that never spoke.
    await expect(fetch('https://sync.example/v1/vaults')).rejects.toThrow('ERR_CONNECTION_REFUSED')
  })

  it('refuses a body it cannot put on the wire', async () => {
    const { fetch, seen } = fake(() => answer())

    await expect(
      fetch('https://sync.example/a', { method: 'POST', body: new Blob(['x']) })
    ).rejects.toThrow(/only text and bytes/)
    expect(seen).toHaveLength(0)
  })

  it('takes a URL as well as a string', async () => {
    const { fetch, seen } = fake(() => answer())

    await fetch(new URL('https://sync.example/v1/vaults?limit=2'))

    expect(seen[0].url).toBe('https://sync.example/v1/vaults?limit=2')
  })
})

describe('wsFor', () => {
  it('hands back the host WebSocket', () => {
    const host = window as { WebSocket?: unknown }
    const real = host.WebSocket
    const stub = function WebSocketStub() {} as unknown as typeof WebSocket
    host.WebSocket = stub
    try {
      expect(wsFor()).toBe(stub)
    } finally {
      host.WebSocket = real
    }
  })

  it('says so when the host has none', () => {
    const host = window as { WebSocket?: unknown }
    const real = host.WebSocket
    delete host.WebSocket
    try {
      expect(() => wsFor()).toThrow(/no WebSocket/)
    } finally {
      host.WebSocket = real
    }
  })
})
