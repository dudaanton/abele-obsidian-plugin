// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { connectStage } from '@/sync/tokenUi'

afterEach(() => vi.useRealTimers())

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
