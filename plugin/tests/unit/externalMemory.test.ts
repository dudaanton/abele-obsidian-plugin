import { describe, expect, it, vi } from 'vitest'
import { sha256 as reference } from '@abele/sync-core'
import { sha256 } from '@/sync/external/hash'
import { binaryResponse } from '@/sync/binaryResponse'

describe('bounded attachment buffers', () => {
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
