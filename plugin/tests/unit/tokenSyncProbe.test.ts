import { expect, it, vi } from 'vitest'
import { tokenSyncProbe } from '@/testing/tokenSyncProbe'
it('observes real transport counts without private options and releases its observer', () => {
  let notify!: (path: string, active: boolean) => void
  const stop = vi.fn()
  const runtime = {
    observeTransport: (listener: typeof notify) => {
      notify = listener
      return stop
    },
    sync: vi.fn(),
    engine: { runExclusive: vi.fn() },
    client: { verifyExternalFile: vi.fn(), versionBytes: vi.fn() },
  }
  const probe = tokenSyncProbe(runtime as never, () => {})
  notify('/v2/files/sample/external/verify', true)
  notify('/v2/files/sample/external/verify', false)
  notify('/v2/files/sample/content', true)
  notify('/v2/files/sample/content', false)
  expect(probe.stats()).toEqual({ verificationCount: 1, downloadCount: 1, peakDownloads: 1 })
  probe.reset()
  expect(probe.stats().downloadCount).toBe(0)
  probe.close()
  expect(stop).toHaveBeenCalledOnce()
})
