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
