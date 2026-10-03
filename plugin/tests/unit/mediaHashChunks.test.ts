import { describe, expect, it, vi } from 'vitest'
import { hashMediaBytes } from '@/media/contentHash'

function previousHash(data: Uint8Array): string {
  let h = 0x811c9dc5
  for (const byte of data) h = Math.imul(h ^ byte, 0x01000193)
  return (h >>> 0).toString(36)
}

describe('cooperative media fingerprints', () => {
  it.each([0, 1, 100, 1024 * 1024 + 1, 3 * 1024 * 1024])('preserves the fingerprint of %i bytes while yielding between chunks', async (length) => {
    const data = new Uint8Array(length)
    for (let i = 0; i < length; i++) data[i] = i % 251
    const yieldWork = vi.fn(async () => {})
    expect(await hashMediaBytes(data.buffer, yieldWork)).toBe(previousHash(data))
    expect(yieldWork).toHaveBeenCalledTimes(Math.max(0, Math.ceil(length / (1024 * 1024)) - 1))
  })
})
