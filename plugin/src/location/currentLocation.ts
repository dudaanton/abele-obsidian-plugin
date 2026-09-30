/** One-shot location acquisition, independent of Obsidian, storage and network services. */
export interface CurrentLocation {
  latitude: number
  longitude: number
  /** Estimated accuracy radius in metres. */
  accuracy: number
  /** Acquisition time in milliseconds since the Unix epoch, as reported by the provider. */
  timestamp: number
}

export type LocationProvider = Pick<Geolocation, 'getCurrentPosition'>
export const LOCATION_TIMEOUT_MS = 15_000

export function locationError(code: number): Error {
  switch (code) {
    case 1:
      return new Error(
        'Location permission was denied. Allow location for Obsidian in the device privacy settings and, if prompted, allow it for this page, then try again.'
      )
    case 3:
      return new Error(
        'Location request timed out. Check Location Services and Obsidian permissions in the device settings, then try again; this platform may not have a location provider.'
      )
    default:
      return new Error(
        'Location is unavailable on this device. Enable Location Services and allow Obsidian in the device privacy settings, then try again. If the platform has no location provider, use a device that supports location or give a place manually.'
      )
  }
}

/**
 * The platform timeout does not always cover permission prompts or broken providers. A wall-clock
 * watchdog bounds those too. Browser geolocation cannot be cancelled; late callbacks are ignored.
 */
export function requestCurrentLocation(
  provider: LocationProvider | undefined,
  signal?: AbortSignal
): Promise<CurrentLocation> {
  if (signal?.aborted) return Promise.reject(new Error('Location request cancelled.'))
  if (!provider) {
    return Promise.reject(
      new Error(
        'Location is not available on this device: the platform exposes no location API. Use a device that supports location or give a place manually.'
      )
    )
  }

  return new Promise((resolve, reject) => {
    let done = false
    const finish = (location?: CurrentLocation, error?: Error) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else if (location) resolve(location)
    }
    const abort = () => finish(undefined, new Error('Location request cancelled.'))
    const timer = window.setTimeout(() => finish(undefined, locationError(3)), LOCATION_TIMEOUT_MS)
    signal?.addEventListener('abort', abort, { once: true })

    try {
      provider.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords
          const timestamp = position.timestamp
          if (
            !Number.isFinite(latitude) ||
            Math.abs(latitude) > 90 ||
            !Number.isFinite(longitude) ||
            Math.abs(longitude) > 180 ||
            !Number.isFinite(accuracy) ||
            accuracy < 0 ||
            !Number.isFinite(timestamp) ||
            timestamp < 0
          ) {
            finish(undefined, locationError(2))
            return
          }
          finish({ latitude, longitude, accuracy, timestamp })
        },
        (error) => finish(undefined, locationError(error.code)),
        { maximumAge: 0, timeout: LOCATION_TIMEOUT_MS, enableHighAccuracy: true }
      )
    } catch (error) {
      finish(
        undefined,
        locationError(error instanceof Error && error.name === 'SecurityError' ? 1 : 2)
      )
    }
  })
}
