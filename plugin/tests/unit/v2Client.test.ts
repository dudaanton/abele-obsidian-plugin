import { describe, expect, it } from 'vitest'
import { decodeAccessToken, V2Client, V2ClientError } from '@/sync/v2/client'

const token = {
  v: 1,
  address: 'https://sync.example',
  key: 'a'.repeat(43),
  scope: { kind: 'folder', id: 'root', path: '/' },
}
const encoded = () => btoa(JSON.stringify(token))
const authority = {
  protocol: 2,
  token_id: 'token-a',
  space_id: 'space-a',
  scope: token.scope,
  status: 'active',
  limits: { max_file_bytes: 1024, quota_bytes: null },
}
describe('v2 token client', () => {
  it('decodes the QR payload without Node APIs and rejects malformed or insecure tokens', () => {
    expect(decodeAccessToken(encoded())).toEqual(token)
    for (const text of [
      'not base64',
      btoa('{}'),
      btoa(JSON.stringify({ ...token, address: 'http://sync.example' })),
    ])
      expect(() => decodeAccessToken(text)).toThrow(V2ClientError)
  })
  it('uses only the token authority and keeps secrets out of URLs', async () => {
    const calls: [string, RequestInit | undefined][] = []
    const client = new V2Client(decodeAccessToken(encoded()), async (url, init) => {
      calls.push([String(url), init])
      return Response.json(authority)
    })
    expect(await client.connection()).toEqual(authority)
    expect(calls[0][0]).toBe('https://sync.example/v2/connection')
    expect(new Headers(calls[0][1]?.headers).get('Authorization')).toBe('Bearer ' + token.key)
  })
  it('distinguishes malformed tokens, an unreachable server, and a refused key', async () => {
    const offline = new V2Client(token as ReturnType<typeof decodeAccessToken>, async () => {
      throw new Error('transport details')
    })
    await expect(offline.connection()).rejects.toMatchObject({ code: 'unreachable' })
    const revoked = new V2Client(token as ReturnType<typeof decodeAccessToken>, async () =>
      Response.json({ error: { code: 'unauthorized' } }, { status: 401 })
    )
    await expect(revoked.connection()).rejects.toMatchObject({ code: 'revoked' })
  })
  it('preserves the idempotency key and rejects malformed server replies', async () => {
    let headers = new Headers()
    const client = new V2Client(
      token as ReturnType<typeof decodeAccessToken>,
      async (_url, init) => {
        headers = new Headers(init?.headers)
        return Response.json({ cursor: 1, results: [] })
      }
    )
    await expect(
      client.commit([{ op: 'mkdir', path: 'Shared' }], 'request-a')
    ).rejects.toMatchObject({ code: 'invalid-response' })
    expect(headers.get('Idempotency-Key')).toBe('request-a')
  })
  it('issues, lists and revokes tokens through the same authority', async () => {
    const info = {
      id: 'child',
      scope: token.scope,
      label: 'Sample device',
      issued_by_token_id: 'parent',
      created_at: '2026-01-01T00:00:00Z',
      revoked_at: null,
    }
    const calls: [string, string, unknown][] = []
    const client = new V2Client(
      token as ReturnType<typeof decodeAccessToken>,
      async (url, init) => {
        const method = init?.method ?? 'GET'
        calls.push([String(url), method, init?.body ? JSON.parse(String(init.body)) : null])
        return Response.json(
          method === 'POST'
            ? { token: encoded(), info }
            : method === 'DELETE'
              ? { revoked: true }
              : { items: [info] }
        )
      }
    )
    expect(
      (await client.issue({ scope: { kind: 'folder', id: 'root' }, label: 'Sample device' })).info
    ).toEqual(info)
    expect((await client.tokens()).items).toEqual([info])
    expect(await client.revoke('child')).toEqual({ revoked: true })
    expect(calls.map((call) => call.slice(0, 2))).toEqual([
      ['https://sync.example/v2/tokens', 'POST'],
      ['https://sync.example/v2/tokens', 'GET'],
      ['https://sync.example/v2/tokens/child', 'DELETE'],
    ])
  })
  it('encodes opaque paging values without altering the destination', async () => {
    const calls: string[] = []
    const client = new V2Client(token as ReturnType<typeof decodeAccessToken>, async (url) => {
      calls.push(String(url))
      return Response.json({ items: [], cursor: 7, next: null })
    })
    await client.manifest('page/&secret=no')
    await client.changes(5, 'page/&secret=no')
    expect(new URL(calls[0]).searchParams.get('next')).toBe('page/&secret=no')
    expect(new URL(calls[1]).searchParams.get('since')).toBe('5')
    expect(new URL(calls[1]).searchParams.size).toBe(2)
  })
  it('never includes an untrusted response body in an error', async () => {
    const client = new V2Client(token as ReturnType<typeof decodeAccessToken>, async () =>
      Response.json({ error: { code: token.key } }, { status: 500 })
    )
    await expect(client.connection()).rejects.toMatchObject({
      code: 'server-error',
      message: 'Sync connection: server-error',
    })
  })
  it('has the documented upload/content calls for a production engine', () => {
    expect(V2Client.prototype).toHaveProperty('putContent')
    expect(V2Client.prototype).toHaveProperty('content')
  })
})
