import { expect, it, vi } from 'vitest'
import { tokenSyncProbe } from '@/testing/tokenSyncProbe'
it('waits for transient first-contact failures to recover before reporting fixture readiness', async () => {
  vi.useFakeTimers()
  try {
    const sync = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Sync interrupted'), { code: 'offline' }))
      .mockResolvedValue(undefined)
    const probe = tokenSyncProbe(
      { observeTransport: () => () => {}, sync, client: {}, engine: {} } as never,
      () => {}
    )
    const result = probe.sync().catch((error) => error)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await result).toBeUndefined()
    expect(sync).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
it('observes real transport counts without private options and releases its observer', () => {
  let notify!: (path: string, active: boolean, successful?: boolean, rangeOffset?: number) => void
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
  notify('/v2/files/sample/external/verify', false, false)
  expect(probe.stats().verificationCount).toBe(0)
  notify('/v2/files/sample/external/verify', true)
  notify('/v2/files/sample/external/verify', false, true)
  notify('/v2/files/sample/content', true)
  notify('/v2/files/sample/content', false)
  expect(probe.stats()).toEqual({ verificationCount: 1, downloadCount: 1, peakDownloads: 1 })
  probe.reset()
  for (const offset of [0, 1024 * 1024, 2 * 1024 * 1024]) {
    notify('/v2/files/sample/content', true, undefined, offset)
    notify('/v2/files/sample/content', false, true, offset)
  }
  expect(probe.stats()).toEqual({ verificationCount: 1, downloadCount: 1, peakDownloads: 1 })
  probe.reset()
  expect(probe.stats().downloadCount).toBe(0)
  probe.close()
  expect(stop).toHaveBeenCalledOnce()
})
