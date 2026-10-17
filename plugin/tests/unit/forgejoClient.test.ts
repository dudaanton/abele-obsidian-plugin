import { describe, expect, it, vi } from 'vitest'
import { ForgejoClient } from '@/forge/forgejoClient'
import { deployment } from '@/forge/identity'
import type { HttpResponse, HttpTransport } from '@/forge/transport'

const base = deployment('forgejo', 'https://forge.example.test/team')
const response = (json: unknown, status = 200): HttpResponse => ({
  status,
  headers: {},
  json,
  text: JSON.stringify(json),
  arrayBuffer: new ArrayBuffer(0),
})
const session = () => ({ connectionId: 'sample', generation: 'one', assertCurrent: vi.fn() })

describe('Forgejo credential-bound reads', () => {
  it('allows an explicit retry of an idempotent notification read after response loss', async () => {
    const http = vi
      .fn<HttpTransport>()
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockResolvedValue(response(null, 204))
    const client = new ForgejoClient(base, { ...session(), connectionId: 'sample-read' }, http, '')
    await expect(
      client.write('PATCH', '/notifications/threads/8?to-status=read', undefined, 'none', true)
    ).rejects.toThrow(/unknown/i)
    expect(http).toHaveBeenCalledOnce()
    await client.write('PATCH', '/notifications/threads/8?to-status=read', undefined, 'none', true)
    expect(http).toHaveBeenCalledTimes(2)
  })
  it('reads a sized local avatar without attaching the repository token', async () => {
    const http = vi.fn<HttpTransport>().mockResolvedValue({
      ...response(null),
      arrayBuffer: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
    })
    const client = new ForgejoClient(base, session(), http, 'sample-token')
    expect(await client.avatar(`${base.webBase}/avatars/sample.png?size=64`)).toMatch(
      /^data:image\/png;base64,/
    )
    expect(http.mock.calls[0][0].headers.Authorization).toBeUndefined()
    expect(await client.avatar(`${base.webBase}/avatars/sample.png?token=sample`)).toBeNull()
    expect(http).toHaveBeenCalledOnce()
  })
  it('sends a mutation once and reports response loss without a retry', async () => {
    const http = vi.fn<HttpTransport>().mockRejectedValue(new Error('sample-token response lost'))
    const client = new ForgejoClient(base, session(), http, 'sample-token')
    await expect(
      client.write('POST', '/repos/sample/project/pulls', { title: 'Sample' })
    ).rejects.toThrow(/outcome is unknown/i)
    await expect(
      client.write('POST', '/repos/sample/project/pulls', { title: 'Sample' })
    ).rejects.toThrow(/outcome is unknown/i)
    expect(http).toHaveBeenCalledOnce()
    expect(http.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ title: 'Sample' }),
    })
  })
  it.each([
    ['rotated-token', 'sample-new-token', 31],
    ['unlocked-keys', 'sample-token', 32],
  ])(
    'retains an uncertain comment across %s and a new client',
    async (generation, token, index) => {
      const http = vi
        .fn<HttpTransport>()
        .mockRejectedValueOnce(new Error('Response lost'))
        .mockResolvedValue(response({ id: 99 }))
      const authority = { ...session(), connectionId: 'sample-uncertain-comment' }
      const path = '/repos/sample/project/issues/' + index + '/comments'
      const body = { body: 'Sample comment' }
      const original = new ForgejoClient(base, authority, http, 'sample-token')
      await expect(original.write('POST', path, body)).rejects.toThrow(/outcome is unknown/i)
      const reopened = new ForgejoClient(
        base,
        { ...authority, generation: String(generation) },
        http,
        String(token)
      )
      await expect(reopened.write('POST', path, body)).rejects.toThrow(/outcome is unknown/i)
      expect(http).toHaveBeenCalledOnce()
      await reopened.write('POST', path, { body: 'A different sample comment' })
      expect(http).toHaveBeenCalledTimes(2)
      const other = new ForgejoClient(
        base,
        { ...authority, connectionId: 'other-comment-account' },
        http,
        String(token)
      )
      await other.write('POST', path, body)
      const elsewhere = new ForgejoClient(
        deployment('forgejo', 'https://other.example.test/team'),
        authority,
        http,
        String(token)
      )
      await elsewhere.write('POST', path, body)
      expect(http).toHaveBeenCalledTimes(4)
    }
  )
  it('reads native archive bytes through the same credential boundary', async () => {
    const bytes = new Uint8Array([31, 139, 8]).buffer
    const http = vi.fn<HttpTransport>().mockResolvedValue({ ...response(null), arrayBuffer: bytes })
    const client = new ForgejoClient(base, session(), http, 'sample-token')
    expect(await client.bytes('/repos/sample/project/archive/sample.tar.gz')).toBe(bytes)
    expect(http).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Accept: 'application/octet-stream', Authorization: 'token sample-token' },
      })
    )
  })
  it('does not publish malformed-response parser diagnostics containing credentials', async () => {
    const client = new ForgejoClient(
      base,
      session(),
      async () => ({
        ...response(null),
        get json() {
          throw new Error('sample-token in invalid JSON')
        },
      }),
      'sample-token'
    )
    await expect(client.get('/user')).rejects.toThrow('Forgejo returned an unreadable response.')
  })
  it('reads a native unified diff as text through the same credential boundary', async () => {
    const http = vi
      .fn<HttpTransport>()
      .mockResolvedValue({ ...response(null), text: '@@ -1 +1 @@\n-before\n+after\n' })
    const client = new ForgejoClient(base, session(), http, 'sample-token')
    expect(await client.text('/repos/sample/project/pulls/12.diff')).toContain('+after')
  })
  it('does not publish transport diagnostics containing credentials', async () => {
    const client = new ForgejoClient(
      base,
      session(),
      async () => {
        throw new Error('Authorization: token sample-token')
      },
      'sample-token'
    )
    await expect(client.get('/user')).rejects.toThrow('Could not reach the Forgejo service.')
  })
  it('uses the configured API subpath and native token scheme', async () => {
    const http = vi.fn<HttpTransport>().mockResolvedValue(response({ login: 'sample' }))
    const client = new ForgejoClient(base, session(), http, 'sample-token')
    expect(await client.get('/user')).toEqual({ login: 'sample' })
    expect(http).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${base.apiBase}/user`,
        headers: { Accept: 'application/json', Authorization: 'token sample-token' },
        throw: false,
      })
    )
  })
  it('checks the generation after a pending read before publishing', async () => {
    const authority = session()
    const client = new ForgejoClient(
      base,
      authority,
      async () => {
        authority.assertCurrent.mockImplementation(() => {
          throw new Error('Retired')
        })
        return response({ login: 'sample' })
      },
      'sample-token'
    )
    await expect(client.get('/user')).rejects.toThrow('Retired')
  })
  it.each([
    'https://outside.example.test/user',
    '//outside.example.test/user',
    '/../user',
    '/%2e%2e/user',
    '/%2e%2e%2fuser',
    '/repos/sample/project?token=secret',
  ])('rejects unsafe request %s before transport', async (path) => {
    const http = vi.fn<HttpTransport>()
    const client = new ForgejoClient(base, session(), http, 'sample-token')
    await expect(client.get(path)).rejects.toThrow()
    expect(http).not.toHaveBeenCalled()
  })
  it('never follows a redirect with credentials', async () => {
    const http = vi.fn<HttpTransport>().mockResolvedValue(response({}, 302))
    const client = new ForgejoClient(base, session(), http, 'sample-token')
    await expect(client.get('/user')).rejects.toThrow(/redirect/i)
    expect(http).toHaveBeenCalledTimes(1)
  })
  it('uses native limit/page and preserves incomplete results at a cap', async () => {
    const http = vi
      .fn<HttpTransport>()
      .mockResolvedValueOnce(response([{ id: 1 }, { id: 2 }]))
      .mockResolvedValueOnce(response([{ id: 3 }]))
    const client = new ForgejoClient(base, session(), http, '')
    expect(await client.pages('/repos/sample/project/issues?state=all', 2)).toEqual({
      value: [{ id: 1 }, { id: 2 }, { id: 3 }],
      complete: true,
      notes: [],
    })
    expect(http.mock.calls[1][0].url).toBe(
      `${base.apiBase}/repos/sample/project/issues?state=all&limit=2&page=2`
    )
    http.mockResolvedValue(response([{ id: 1 }, { id: 2 }]))
    expect(await client.pages('/repos/sample/project/issues', 2, 1)).toMatchObject({
      complete: false,
      notes: [expect.any(String)],
    })
  })
  it('does not expose server error bodies or credentials', async () => {
    const client = new ForgejoClient(
      base,
      session(),
      async () => response({ message: 'sample-token' }, 401),
      'sample-token'
    )
    await expect(client.get('/user')).rejects.toThrow('Forgejo refused the request (401).')
  })
})
