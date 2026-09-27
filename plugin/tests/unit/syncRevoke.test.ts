/**
 * Telling a server a device has left: what counts as told, what is tried again later, and what
 * is never sent at all. The round trip against a real server is in the integration tier; this
 * is the reading of each answer, against a `fetch` that counts what it was asked.
 */
import { describe, it, expect } from 'vitest'
import { tellServer } from '@/sync/revoke'

const TOKEN = 'absd_0123456789'

/** A `fetch` that answers every request with `answer`, and remembers what it was asked. */
function counting(answer: () => Promise<Response>): typeof fetch & { calls: string[] } {
  const calls: string[] = []
  const fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input))
    return answer()
  }) as typeof globalThis.fetch & { calls: string[] }
  fetch.calls = calls
  return fetch
}

const envelope = (code: string, status: number): Response =>
  new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('telling the server this device left', () => {
  it('says revoked when the server took the token back', async () => {
    const fetch = counting(() => Promise.resolve(new Response(null, { status: 204 })))

    expect(await tellServer('https://sync.example.com', TOKEN, fetch)).toEqual({ told: 'revoked' })
    expect(fetch.calls).toEqual(['https://sync.example.com/v1/devices/self'])
  })

  it('says already when the server no longer takes the token', async () => {
    const fetch = counting(() => Promise.resolve(envelope('unauthorized', 401)))

    expect((await tellServer('https://sync.example.com', TOKEN, fetch)).told).toBe('already')
  })

  it('tries again later when the server is unreachable or failing', async () => {
    const gone = counting(() => Promise.reject(new Error('the network is gone')))
    const failing = counting(() => Promise.resolve(envelope('internal', 503)))

    expect((await tellServer('https://sync.example.com', TOKEN, gone)).told).toBe('failed')
    expect((await tellServer('https://sync.example.com', TOKEN, failing)).told).toBe('failed')
  })

  it('gives up waiting on a server that never answers', async () => {
    const silent = counting(() => new Promise<Response>(() => undefined))

    const told = await tellServer('https://sync.example.com', TOKEN, silent, 20)

    expect(told.told).toBe('failed')
    expect(told.reason).toContain('did not answer')
  })

  it('sends nothing that is not a device token, nor to an address the https rule refuses', async () => {
    const fetch = counting(() => Promise.resolve(new Response(null, { status: 204 })))

    expect((await tellServer('https://sync.example.com', 'sk-provider', fetch)).told).toBe(
      'unusable'
    )
    expect((await tellServer('https://sync.example.com', '', fetch)).told).toBe('unusable')
    expect((await tellServer('http://192.168.1.5:8787', TOKEN, fetch)).told).toBe('unusable')
    expect(fetch.calls).toEqual([])
  })
})
