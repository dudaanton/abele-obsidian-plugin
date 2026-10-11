import { expect, it, vi } from 'vitest'
import { residentMemorySampler } from '../e2e/helpers/residentMemory'
it('uses the native current-app resident memory measurement when renderer RSS is absent', async () => {
  const getInfo = vi.fn(async () => ({ memUsed: 123456 }))
  const sample = residentMemorySampler({ Capacitor: { Plugins: { Device: { getInfo } } } })
  expect(await sample!()).toBe(123456)
  expect(getInfo).toHaveBeenCalledOnce()
})
it('keeps injected and renderer RSS measurements ahead of optional native sampling', async () => {
  const getInfo = vi.fn(async () => ({ memUsed: 123456 }))
  const sample = residentMemorySampler({
    __abeleExternalMemoryBytes: () => 345678,
    Capacitor: { Plugins: { Device: { getInfo } } },
  })
  expect(await sample!()).toBe(345678)
  expect(
    await residentMemorySampler({ process: { memoryUsage: () => ({ rss: 234567 }) } })!()
  ).toBe(234567)
  expect(getInfo).not.toHaveBeenCalled()
})
it('reports absence and preserves unsupported native measurements for the live assertion', async () => {
  expect(residentMemorySampler({})).toBeNull()
  const sample = residentMemorySampler({
    Capacitor: { Plugins: { Device: { getInfo: async () => ({}) } } },
  })
  expect(await sample!()).toBeNaN()
})
