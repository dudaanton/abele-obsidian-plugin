import { afterEach, expect, it, vi } from 'vitest'
import { createDisplayClock } from '@/helpers/displayClock'

afterEach(() => vi.useRealTimers())
it('coalesces a hundred countdowns at their minute boundary without losing second displays', () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  let wakes = 0
  const clock = createDisplayClock({
    now: () => Date.now(),
    schedule(fn, delay) {
      const timer = setTimeout(() => {
        wakes++
        fn()
      }, delay)
      return () => clearTimeout(timer)
    },
  })
  const stop = Array.from({ length: 100 }, () => clock.subscribe(60_000, () => {}, 1000))
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(60_000)
  expect(wakes).toBe(1)
  const elapsed = vi.fn()
  const stopElapsed = clock.subscribe(1000, elapsed)
  vi.advanceTimersByTime(2000)
  expect(elapsed).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(1)
  stopElapsed()
  stop.forEach((fn) => fn())
  expect(vi.getTimerCount()).toBe(0)
})
