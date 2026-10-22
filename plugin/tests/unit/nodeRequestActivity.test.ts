import { expect, it, vi } from 'vitest'
import { NodeRequestActivity } from '@/node/NodeRequestActivity'
it('only publishes sustained pending work and clears timers on settle or close', () => {
  vi.useFakeTimers()
  try {
    const activity = new NodeRequestActivity()
    const first = activity.start()
    vi.advanceTimersByTime(2999)
    expect(activity.slowSince.value).toBe(0)
    first()
    vi.advanceTimersByTime(1)
    expect(activity.slowSince.value).toBe(0)
    const second = activity.start()
    vi.advanceTimersByTime(3000)
    expect(activity.slowSince.value).toBeGreaterThan(0)
    second()
    expect(activity.slowSince.value).toBe(0)
    activity.start()
    activity.destroy()
    vi.advanceTimersByTime(3000)
    expect(activity.slowSince.value).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
