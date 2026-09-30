import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestCurrentLocation, LOCATION_TIMEOUT_MS } from '@/location/currentLocation'

// Invented positions only; no device or network is used by these tests.
const position = {
  coords: { latitude: 12.345, longitude: 67.89, accuracy: 24 },
  timestamp: 1234567890000,
} as GeolocationPosition

const provider = (getCurrentPosition: Geolocation['getCurrentPosition']) => ({ getCurrentPosition })

afterEach(() => vi.useRealTimers())

describe('one current device position', () => {
  it('requests a fresh position with a finite timeout and returns only the needed fields', async () => {
    const get = vi.fn((success: PositionCallback) => success(position))
    expect(await requestCurrentLocation(provider(get))).toEqual({
      latitude: 12.345,
      longitude: 67.89,
      accuracy: 24,
      timestamp: 1234567890000,
    })
    expect(get.mock.calls[0][2]).toEqual({
      maximumAge: 0,
      timeout: LOCATION_TIMEOUT_MS,
      enableHighAccuracy: true,
    })
  })

  it('explains a missing platform API without substituting a position', async () => {
    await expect(requestCurrentLocation(undefined)).rejects.toThrow(/not available.*device/i)
  })

  it.each([
    [1, /permission.*settings/i],
    [2, /unavailable.*Location Services/i],
    [3, /timed out.*try again/i],
  ])('explains provider error %i with a next step', async (code, message) => {
    await expect(
      requestCurrentLocation(
        provider((_success, failure) => {
          failure!({ code, message: 'provider detail' } as GeolocationPositionError)
        })
      )
    ).rejects.toThrow(message)
  })

  it('bounds a provider that never calls back, including a silent permission prompt', async () => {
    vi.useFakeTimers()
    const request = requestCurrentLocation(provider(() => {}))
    const rejected = expect(request).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(LOCATION_TIMEOUT_MS)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the watchdog on success', async () => {
    vi.useFakeTimers()
    await requestCurrentLocation(provider((success) => success(position)))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('handles a synchronous platform failure', async () => {
    await expect(
      requestCurrentLocation(
        provider(() => {
          throw new Error('platform failure')
        })
      )
    ).rejects.toThrow(/unavailable/i)
  })

  it('aborts without waiting for the provider and ignores its late callback', async () => {
    vi.useFakeTimers()
    let reply: PositionCallback
    const controller = new AbortController()
    const request = requestCurrentLocation(
      provider((success) => {
        reply = success
      }),
      controller.signal
    )
    const rejected = expect(request).rejects.toThrow(/cancelled/i)
    controller.abort()
    await rejected
    reply!(position)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not call the platform for an already aborted request', async () => {
    const get = vi.fn()
    const controller = new AbortController()
    controller.abort()
    await expect(requestCurrentLocation(provider(get), controller.signal)).rejects.toThrow(
      /cancelled/i
    )
    expect(get).not.toHaveBeenCalled()
  })

  it('refuses malformed positions rather than centering a map on them', async () => {
    await expect(
      requestCurrentLocation(
        provider((success) =>
          success({
            ...position,
            coords: { ...position.coords, latitude: NaN },
          })
        )
      )
    ).rejects.toThrow(/unavailable/i)
  })
})
