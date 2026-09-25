/**
 * The keys a transfer brought, put where each one belongs on the receiving device.
 *
 * Most go through `secrets()` like a key typed by hand, and so into the synced store when it is
 * open here. A key of a `deviceOnly` section — the sync device token — goes into this device's
 * keychain alone: it travelled because the user asked for this one transfer, which is no reason
 * to hand it on to every other device the store reaches.
 */
import { secrets } from '@/secrets/SecretStore'
import { isDeviceOnly } from './entries'
import type { TransferEntry } from './types'

/** Returns how many keys the keychain refused. */
export function storeReceivedKeys(
  entries: TransferEntry[],
  received: Record<string, string>
): number {
  let refused = 0
  for (const entry of entries) {
    const road = isDeviceOnly(entry.section) ? secrets().device : secrets()
    for (const secretId of entry.secretIds ?? []) {
      const value = received[secretId]
      // A key that did not travel leaves whatever this device already has alone.
      if (!value) continue

      try {
        road.set(secretId, value)
      } catch {
        // Obsidian takes only lowercase letters, digits and dashes for a key's name, and a
        // transfer can carry any name at all — one it refuses must not abandon the rest of
        // the settings half written.
        refused++
      }
    }
  }
  return refused
}
