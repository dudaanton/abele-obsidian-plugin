import { describe, expect, it, vi } from 'vitest'
import { sha256 as reference } from '@abele/sync-core'
import { sha256 } from '@/sync/external/hash'
import { binaryResponse } from '@/sync/binaryResponse'
import { rangedBinaryTransport } from '@/sync/rangedBinaryTransport'
import { fetchViaCapacitorHttp } from '@/sync/mobileTransport'

describe('bounded attachment buffers', () => {
  it('decodes only bounded native base64 responses while assembling one large buffer', async () => {
    const size = 2 * 1024 * 1024 + 7
    const request = vi.fn(async (options) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.range)!
      const start = Number(match[1]),
        end = Math.min(Number(match[2]), size - 1)
      const data = btoa('x'.repeat(end - start + 1))
      expect(data.length).toBeLessThanOrEqual(4 * Math.ceil((1024 * 1024) / 3))
      return {
        status: 206,
        url: options.url,
        data,
        headers: { 'content-range': `bytes ${start}-${end}/${size}` },
      }
    })
    const response = await rangedBinaryTransport(fetchViaCapacitorHttp({ request }))(
      'https://example.invalid/v1/blobs/' + 'a'.repeat(64)
    )
    expect((await response.arrayBuffer()).byteLength).toBe(size)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it.each(['changed-total', 'truncated', 'interrupted'])(
    'rejects %s after the first chunk',
    async (failure) => {
      let calls = 0
      const send = vi.fn<typeof fetch>(async () => {
        calls++
        if (calls === 1)
          return binaryResponse(new Uint8Array(1024 * 1024), {
            status: 206,
            headers: { 'content-range': 'bytes 0-1048575/2097152' },
          })
        return binaryResponse(new Uint8Array(1), {
          status: failure === 'interrupted' ? 200 : 206,
          headers: {
            'content-range':
              failure === 'changed-total'
                ? 'bytes 1048576-2097151/3145728'
                : 'bytes 1048576-2097151/2097152',
          },
        })
      })
      await expect(
        rangedBinaryTransport(send)('https://example.invalid/v1/blobs/' + 'a'.repeat(64))
      ).rejects.toThrow()
      expect(send).toHaveBeenCalledTimes(2)
    }
  )

  it.each([
    '/v1/blobs/' + 'a'.repeat(64),
    '/v1/scoped/vaults/sample-vault/grants/sample-grant/files/sample-file/versions/sample-version',
  ])('bounds every download response for %s', async (path) => {
    const size = 3 * 1024 * 1024 + 7
    const buffers: ArrayBuffer[] = []
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer sample-token')
      const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get('range')!)!
      const start = Number(range[1]),
        end = Math.min(Number(range[2]), size - 1)
      const bytes = new Uint8Array(end - start + 1)
      bytes.fill(91)
      expect(bytes.length).toBeLessThanOrEqual(1024 * 1024)
      buffers.push(bytes.buffer)
      return binaryResponse(bytes, {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${size}` },
      })
    })
    const response = await rangedBinaryTransport(send)('https://example.invalid' + path, {
      headers: { authorization: 'Bearer sample-token' },
    })
    const result = await response.arrayBuffer()
    expect(result.byteLength).toBe(size)
    expect(new Uint8Array(result).every((byte) => byte === 91)).toBe(true)
    expect(buffers.every((buffer) => buffer !== result && buffer.byteLength < size)).toBe(true)
    expect(send).toHaveBeenCalledTimes(4)
  })

  it.each(['bytes 1-1048576/2097152', 'bytes 0-1048575/NaN', 'bytes 0-2097151/2097152'])(
    'rejects invalid range metadata %s',
    async (range) => {
      const send = vi.fn<typeof fetch>(async () =>
        binaryResponse(new Uint8Array(1), {
          status: 206,
          headers: { 'content-range': range },
        })
      )
      await expect(
        rangedBinaryTransport(send)('https://example.invalid/v1/blobs/' + 'a'.repeat(64))
      ).rejects.toThrow()
    }
  )

  it('preserves errors and servers that ignore Range without a second request', async () => {
    const response = binaryResponse(new Uint8Array(7), { status: 200 })
    const send = vi.fn<typeof fetch>(async () => response)
    expect(
      await rangedBinaryTransport(send)('https://example.invalid/v1/blobs/' + 'a'.repeat(64))
    ).toBe(response)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it.each([0, 55, 56, 63, 64, 65, 1048579])(
    'hashes %i bytes without WebCrypto copies',
    async (size) => {
      const backing = new Uint8Array(size + 8)
      backing.forEach((_, i) => {
        backing[i] = i % 251
      })
      const bytes = backing.subarray(3, size + 3)
      const expected = await reference(bytes)
      const digest = vi.spyOn(crypto.subtle, 'digest')
      expect(await sha256(bytes)).toBe(expected)
      expect(digest).not.toHaveBeenCalled()
      digest.mockRestore()
    }
  )
  it('transfers the original response buffer once', async () => {
    const bytes = new Uint8Array(1024 * 1024)
    const response = binaryResponse(bytes, { status: 200 })
    expect(response.bodyUsed).toBe(false)
    expect(await response.arrayBuffer()).toBe(bytes.buffer)
    expect(response.bodyUsed).toBe(true)
    await expect(response.arrayBuffer()).rejects.toThrow()
  })
})
