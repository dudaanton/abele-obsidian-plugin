import { afterEach, expect, it, vi } from 'vitest'
import { decodeHeic } from '@/media/heicDecoder'

const terminate = vi.fn()
const revoked = vi.spyOn(URL, 'revokeObjectURL')
afterEach(() => { vi.unstubAllGlobals(); terminate.mockClear(); revoked.mockClear() })

it('releases the decoder worker and its source URL after successful conversion', async () => {
  const png = new Blob(['png'], { type: 'image/png' })
  vi.stubGlobal('Worker', class {
    onmessage: ((e: { data: { png: Blob } }) => void) | null = null
    terminate = terminate
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: { png } })) }
  })
  expect(await decodeHeic(new Blob(['heic']))).toBe(png)
  expect(terminate).toHaveBeenCalledOnce()
  expect(revoked).toHaveBeenCalledOnce()
})

it('releases the worker on a decoding error too', async () => {
  vi.stubGlobal('Worker', class {
    onmessage: ((e: { data: { error: string } }) => void) | null = null
    terminate = terminate
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: { error: 'bad input' } })) }
  })
  await expect(decodeHeic(new Blob(['bad']))).rejects.toThrow('bad input')
  expect(terminate).toHaveBeenCalledOnce()
  expect(revoked).toHaveBeenCalledOnce()
})
