import { afterEach, expect, it, vi } from 'vitest'
import { deferredCleanup } from '@/helpers/deferredCleanup'

afterEach(() => vi.useRealTimers())
it('does one orphan cleanup after a burst, and none after unload', () => {
  vi.useFakeTimers()
  const cleanup = vi.fn()
  const work = deferredCleanup(cleanup)
  for (let i = 0; i < 20; i++) work.schedule()
  vi.advanceTimersByTime(499)
  expect(cleanup).toHaveBeenCalledTimes(0)
  vi.advanceTimersByTime(1)
  expect(cleanup).toHaveBeenCalledTimes(1)
  work.schedule()
  work.stop()
  vi.advanceTimersByTime(500)
  expect(cleanup).toHaveBeenCalledTimes(1)
})
