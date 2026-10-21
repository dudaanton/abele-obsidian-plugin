import { Platform } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { readConnection } from '@/sync/connection'

/** The owner's existing device label, with a host-neutral fallback for unsynced vaults. */
export function obsidianDeviceName(): string {
  return (
    readConnection(GlobalStore.getInstance().app).deviceName ||
    (Platform.isMobile ? 'Mobile device' : 'Desktop')
  )
}
