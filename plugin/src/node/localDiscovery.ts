import { Platform } from 'obsidian'
import { LocalDiscovery, type DesktopRuntime } from './localDiscoveryCore'
export type { LocalNode } from './localDiscoveryCore'
export function localNodeRegistrationUrl(endpoint: string): string {
  if (!/^ws:\/\/127\.0\.0\.1:\d+\/channel$/.test(endpoint))
    throw new Error('The protected local channel must be exact loopback.')
  const url = new URL(endpoint)
  if (!url.port || Number(url.port) < 1 || Number(url.port) > 65535)
    throw new Error('Invalid local node port')
  return `http://127.0.0.1:${url.port}`
}
/** The protected discovery implementation is shared with the node SDK; only this loader knows Obsidian. */
export function createLocalNodeDiscovery(
  desktop = Platform.isDesktopApp && !Platform.isMobile
): LocalDiscovery {
  return new LocalDiscovery(desktop, () => {
    if (!desktop) throw new Error('desktop_only')
    const load = (window as unknown as { require?: (name: string) => unknown }).require
    if (!load) throw new Error('native_runtime_unavailable')
    return {
      fs: load('fs'),
      net: load('net'),
      os: load('os'),
      path: load('path'),
      process: load('process'),
    } as DesktopRuntime
  })
}
