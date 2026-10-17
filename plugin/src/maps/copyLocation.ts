import { Notice } from 'obsidian'
import { getDeviceLocation } from '@/services/DeviceLocation'
import { LocationRequestError } from '@/location/currentLocation'
import { t } from '@/i18n'

export async function copyMapLocation(signal?: AbortSignal): Promise<void> {
  const waiting = new Notice(t('maps.locating'), 0)
  try {
    const point = await getDeviceLocation(signal)
    if (signal?.aborted) return
    try {
      await navigator.clipboard.writeText(`${point.latitude}, ${point.longitude}`)
      new Notice(t('maps.copied'))
    } catch {
      new Notice(t('maps.copyFailed'))
    }
  } catch (error) {
    if (!signal?.aborted)
      new Notice(
        t(
          error instanceof LocationRequestError && error.code === 1
            ? 'maps.locationDenied'
            : error instanceof LocationRequestError && error.code === 3
              ? 'maps.locationTimeout'
              : 'maps.locationUnavailable'
        )
      )
  } finally {
    waiting.hide()
  }
}
