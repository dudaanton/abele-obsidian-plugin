import { expect, it, vi } from 'vitest'
import { MapFollowing } from '@/maps/core/following'

it('pauses on pan, resumes without another watch, and releases the watch', () => {
  let success: PositionCallback = () => {}
  const geo = {
    watchPosition: vi.fn((cb: PositionCallback) => {
      success = cb
      return 0
    }),
    clearWatch: vi.fn(),
  }
  const move = vi.fn()
  const following = new MapFollowing(geo, move, vi.fn())
  following.toggle()
  success({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition)
  expect(move).toHaveBeenCalledWith({ lat: 1, lon: 2 })
  following.pan()
  success({ coords: { latitude: 3, longitude: 4 } } as GeolocationPosition)
  expect(move).toHaveBeenCalledTimes(1)
  following.toggle()
  expect(move).toHaveBeenLastCalledWith({ lat: 3, lon: 4 })
  expect(geo.watchPosition).toHaveBeenCalledTimes(1)
  following.dispose()
  expect(geo.clearWatch).toHaveBeenCalledWith(0)
})

it('ignores a queued provider callback after disposal', () => {
  let success: PositionCallback = () => {}
  const changed = vi.fn()
  const following = new MapFollowing(
    {
      watchPosition: (cb) => {
        success = cb
        return 1
      },
      clearWatch() {},
    },
    vi.fn(),
    changed
  )
  following.toggle()
  following.dispose()
  const count = changed.mock.calls.length
  success({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition)
  expect(changed).toHaveBeenCalledTimes(count)
})

it('bounds a provider that never answers and releases its watchdog', () => {
  vi.useFakeTimers()
  try {
    const changed = vi.fn()
    const following = new MapFollowing(
      { watchPosition: () => 1, clearWatch() {} },
      vi.fn(),
      changed
    )
    following.toggle()
    vi.advanceTimersByTime(15000)
    expect(following.pending).toBe(false)
    expect(changed).toHaveBeenLastCalledWith(3)
    following.dispose()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('calls default browser timers with their global receiver rather than the clock wrapper', () => {
  const set = vi.fn(function (this: unknown) {
    if (this !== undefined && this !== globalThis && this !== window)
      throw new TypeError('Illegal invocation')
    return 7
  })
  const clear = vi.fn(function (this: unknown) {
    if (this !== undefined && this !== globalThis && this !== window)
      throw new TypeError('Illegal invocation')
  })
  vi.stubGlobal('setTimeout', set)
  vi.stubGlobal('clearTimeout', clear)
  try {
    const geo = { watchPosition: vi.fn(() => 1), clearWatch: vi.fn() }
    const following = new MapFollowing(geo, vi.fn(), vi.fn())
    expect(() => following.toggle()).not.toThrow()
    expect(geo.watchPosition).toHaveBeenCalledOnce()
    expect(() => following.dispose()).not.toThrow()
    expect(clear).toHaveBeenCalledWith(7)
    expect(geo.clearWatch).toHaveBeenCalledWith(1)
  } finally {
    vi.unstubAllGlobals()
  }
})
