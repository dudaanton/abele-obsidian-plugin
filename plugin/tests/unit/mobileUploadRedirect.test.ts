import { expect, it, vi } from 'vitest'
import { fetchViaCapacitorHttp } from '@/sync/mobileTransport'

it.each([301, 302, 303, 307, 308])(
  'refuses %s before redirecting an upload part',
  async (status) => {
    const request = vi.fn(async (options) => {
      expect(options.disableRedirects).toBe(true)
      expect(options.dataType).toBe('file')
      expect(atob(options.data).length).toBe(1024 * 1024)
      return {
        status,
        headers: { Location: 'https://other.example/sink' },
        data: '',
        url: options.url,
      }
    })
    await expect(
      fetchViaCapacitorHttp({ request })('https://sync.example/v2/uploads/sample/session/0', {
        method: 'PUT',
        body: new Uint8Array(1024 * 1024),
        headers: { Authorization: 'Bearer synthetic-grant' },
      })
    ).rejects.toThrow(/redirect/)
    expect(request).toHaveBeenCalledOnce()
  }
)

it.each(['https://sync.example/another-path', 'https://other.example/sink'])(
  'rejects even a successful response from an unexpected URL: %s',
  async (url) => {
    const request = vi.fn(async (options) => {
      // Response validation is a backstop, not permission to follow redirects.
      expect(options.disableRedirects).toBe(true)
      return { status: 200, headers: {}, data: '', url }
    })
    await expect(
      fetchViaCapacitorHttp({ request })('https://sync.example/v2/uploads/sample/session/0', {
        method: 'PUT',
        body: new Uint8Array(1024),
      })
    ).rejects.toMatchObject({ code: 'io', message: expect.stringContaining('redirect') })
    expect(request).toHaveBeenCalledOnce()
  }
)
