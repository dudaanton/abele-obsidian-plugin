// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { connectStage } from '@/sync/tokenUi'
import { SyncCancelled } from '@abele/sync-sdk/core'

afterEach(() => vi.useRealTimers())

it('preserves intentional cancellation through a bounded stage', async () => {
  const cancelled = new SyncCancelled()
  const clock = globalThis as unknown as Pick<Window, 'setTimeout' | 'clearTimeout'>
  await expect(
    connectStage(
      'Reading',
      'Reading failed',
      async () => {
        throw cancelled
      },
      undefined,
      clock
    )
  ).rejects.toBe(cancelled)
})

it.each([false, true])(
  'keeps caller abort distinct from a stage timeout (already aborted=%s)',
  async (aborted) => {
    const controller = new AbortController()
    const work = vi.fn(async () => new Promise<never>(() => {}))
    const clock = globalThis as unknown as Pick<Window, 'setTimeout' | 'clearTimeout'>
    if (aborted) controller.abort()
    const attempt = connectStage('Reading', 'Reading failed', work, controller.signal, clock)
    const failure = expect(attempt).rejects.toBeInstanceOf(SyncCancelled)
    if (!aborted) controller.abort()
    await failure
    expect(work).not.toHaveBeenCalled()
  }
)

it('bounds sync stages without depending on an incidental WebView global in Node tests', async () => {
  expect(typeof window).toBe('undefined')
  const clock = globalThis as unknown as Pick<Window, 'setTimeout' | 'clearTimeout'>
  expect(await connectStage('Reading', 'Reading failed', async () => 42, undefined, clock)).toBe(42)
  vi.useFakeTimers()
  const attempt = connectStage(
    'Reading',
    'Reading failed',
    async () => new Promise(() => {}),
    undefined,
    clock
  )
  const failure = expect(attempt).rejects.toThrow('Reading failed')
  await vi.advanceTimersByTimeAsync(10000)
  await failure
})
