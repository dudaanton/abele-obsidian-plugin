/**
 * The keys a transfer brought, put where each one belongs on the receiving device.
 *
 * Most go through `secrets()` like a key typed by hand, and so into the synced store when it is
 * open here. A key of a `deviceOnly` section goes into this device's keychain alone: it
 * travelled because the user asked for this one transfer, which is no reason to hand it on to
 * every other device the store reaches.
 *
 * A sync device token outside such a section is put nowhere. An older build sent the sender's
 * token in the sync block, beside the sender's connection; the connection is dropped on arrival
 * — it names the sender, and the settings hold no connection any more — so the token has
 * nothing to go with, and the store must never take one whatever section it came under.
 */
import { isDeviceSecretId, secrets } from '@/secrets/SecretStore'
import { isDeviceOnly } from './entries'
import type { TransferEntry } from './types'

/** The one section an older build sent a device token under, beside the sender's connection. */
const OLDER_SYNC_SECTION = 'sync'

/** The section whose token the sync service takes, and nothing here. */
const CONNECTION_SECTION = 'connection'

/** Returns how many keys the keychain refused. */
export function storeReceivedKeys(
  entries: TransferEntry[],
  received: Record<string, string>
): number {
  let refused = 0
  for (const entry of entries) {
    if (entry.section === OLDER_SYNC_SECTION || entry.section === CONNECTION_SECTION) continue
    const deviceOnly = isDeviceOnly(entry.section)
    const road = deviceOnly ? secrets().device : secrets()
    for (const secretId of entry.secretIds ?? []) {
      const value = received[secretId]
      // A key that did not travel leaves whatever this device already has alone.
      if (!value) continue
      if (!deviceOnly && isDeviceSecretId(secretId)) continue

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
