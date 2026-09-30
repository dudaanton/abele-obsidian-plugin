import { describe, it, expect, vi } from 'vitest'
import { nativeRequest } from '@/github/transport'

describe('single-hop GitHub native transport', () => {
  it('accepts native JSON decoding when Content-Type overrides the requested arraybuffer response', async () => {
    const request = vi.fn(async () => ({ status: 200, headers: { 'Content-Type': 'application/json' }, data: { login: 'sample-account' } }))
    const r = await nativeRequest({ url: 'https://git.example.test/api/v3/user' }, { request })
    expect(r.json).toEqual({ login: 'sample-account' })
    expect(r.text).toBe('{"login":"sample-account"}')
  })

  it('disables automatic redirects and asks for base64 bytes on the native bridge', async () => {
    const request = vi.fn(async () => ({
      status: 302,
      headers: { Location: 'https://other.example.test/file' },
      data: 'eA==',
    }))
    const r = await nativeRequest(
      { url: 'https://git.example.test/api/v3/user', headers: { Authorization: 'Bearer fake' } },
      { request }
    )
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ disableRedirects: true, responseType: 'arraybuffer' })
    )
    expect(r.status).toBe(302)
    expect(new Uint8Array(r.arrayBuffer)).toEqual(new Uint8Array([120]))
  })
})
