import { afterEach, expect, it, vi } from 'vitest'
import { stopScrollProfilers } from '../e2e/helpers/stopScrollProfilers.mjs'

afterEach(() => vi.useRealTimers())

it('does not stop an allocation sampler in a timing-only run', async () => {
  const api = { sendCommand: vi.fn().mockResolvedValue({ profile: { nodes: [] } }) }
  expect(await stopScrollProfilers(api, false)).toMatchObject({ allocations: null })
  expect(api.sendCommand.mock.calls.map(([method]) => method)).toEqual([
    'Profiler.stop',
    'Performance.getMetrics',
  ])
})

it.each(['Profiler.stop', 'HeapProfiler.stopSampling', 'Performance.getMetrics'])(
  'bounds a stalled %s command and identifies the phase before the outer script deadline',
  async (stalled) => {
    vi.useFakeTimers()
    const api = {
      sendCommand: vi.fn((method: string) =>
        method === stalled ? new Promise(() => {}) : Promise.resolve({ profile: {} })
      ),
    }
    let failure: unknown
    const pending = stopScrollProfilers(api, true, 100).catch((error: unknown) => {
      failure = error
    })
    await vi.advanceTimersByTimeAsync(101)
    expect(String(failure)).toContain(stalled)
    await pending
    expect(vi.getTimerCount()).toBe(0)
  }
)
