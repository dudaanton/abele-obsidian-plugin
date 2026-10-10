import { expect, it, vi } from 'vitest'
import { ExchangeTrace } from '@/sync/exchangeTrace'
it('retains timestamps and failure outcome after a request leaves active diagnostics', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  try {
    const trace = new ExchangeTrace()
    await expect(
      trace.run('POST /v2/commit', async () => {
        vi.setSystemTime(31000)
        throw new Error('timeout')
      })
    ).rejects.toThrow('timeout')
    expect(trace.snapshot()).toMatchObject({
      active: [],
      requests: [
        { operation: 'POST /v2/commit', startedAt: 1000, durationMs: 30000, outcome: 'failed' },
      ],
    })
  } finally {
    vi.useRealTimers()
  }
})
