import { Platform } from 'obsidian'
import { requestCurrentLocation, type CurrentLocation } from '@/location/currentLocation'

export interface DeviceLocation extends CurrentLocation {
  /** Platform of this Obsidian instance, not a remote device or a hardware identifier. */
  device: string
}

/** Thin platform adapter: no caching, persistence, reverse lookup or IP-based fallback. */
export async function getDeviceLocation(
  signal?: AbortSignal,
  nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator
): Promise<DeviceLocation> {
  const position = await requestCurrentLocation(nav?.geolocation, signal)
  const platform = Platform.isIosApp
    ? 'iOS'
    : Platform.isAndroidApp
      ? 'Android'
      : Platform.isMacOS
        ? 'macOS'
        : Platform.isWin
          ? 'Windows'
          : Platform.isLinux
            ? 'Linux'
            : 'this platform'
  return { ...position, device: `Obsidian on ${platform} (device running this chat)` }
}
