import { expect, it, vi } from 'vitest'
import { NodeRequestActivity } from '@/node/NodeRequestActivity'
it('keeps intentional debugger waits independent of responsive file and status requests', () => {
  vi.useFakeTimers()
  try {
    const activity = new NodeRequestActivity()
    for (let round = 0; round < 4; round++) {
      const wait = activity.start('debugger.v1.wait', { timeout_ms: 4000 })
      for (let event = 0; event < 8; event++) {
        const read = activity.start('debugger.v1.status')
        const tree = activity.start('node.path.list')
        vi.advanceTimersByTime(100)
        read()
        tree()
        vi.advanceTimersByTime(400)
        expect(activity.slowSince.value).toBe(0)
      }
      wait()
    }
    const stalled = activity.start('debugger.v1.wait', { timeout_ms: 4000 })
    vi.advanceTimersByTime(7000)
    expect(activity.slowSince.value).toBeGreaterThan(0)
    stalled()
    activity.destroy()
  } finally {
    vi.useRealTimers()
  }
})

it('keeps a slow episode visible until overlapping foreground requests answer', () => {
  vi.useFakeTimers()
  try {
    const activity = new NodeRequestActivity()
    const first = activity.start()
    vi.advanceTimersByTime(2900)
    const second = activity.start()
    vi.advanceTimersByTime(100)
    const since = activity.slowSince.value
    expect(since).toBeGreaterThan(0)
    first()
    expect(activity.slowSince.value).toBe(since)
    vi.advanceTimersByTime(3000)
    expect(activity.slowSince.value).toBe(since)
    second()
    expect(activity.slowSince.value).toBe(0)
    activity.destroy()
  } finally {
    vi.useRealTimers()
  }
})
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
