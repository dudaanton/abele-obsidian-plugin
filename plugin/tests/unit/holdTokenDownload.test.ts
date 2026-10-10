import { expect, it, vi } from 'vitest'
import { holdTokenDownload } from '@/testing/holdTokenDownload'
it('holds actual received bytes once, restores the client and fences stale release', async () => {
  const original = vi.fn(async () => new Uint8Array([1, 2]))
  const runtime = { client: { versionBytes: original } }
  let current = true
  const gate = holdTokenDownload(runtime as never, () => {
    if (!current) throw new Error('lost')
  })
  const result = runtime.client.versionBytes().catch((error) => error)
  await gate.ready
  expect(original).toHaveBeenCalledOnce()
  current = false
  gate.close()
  expect(await result).toEqual(new Error('lost'))
  expect(runtime.client.versionBytes).toBe(original)
})
