/**
 * How every id on the device-only road starts: the sync device token's, as the sync service
 * mints it. The id itself is read out of the settings, which an agent or another device's
 * `data.json` can write, so the road checks the name rather than trusting it — pointed at a
 * provider's key, it would otherwise send that key to a server and delete it on Disconnect.
 */
export const DEVICE_SECRET_PREFIX = 'abele-sync-device-'

/** Whether an id is one the device-only road may touch: the prefix and something after it. */
export function isDeviceSecretId(id: string | undefined | null): id is string {
  return (
    typeof id === 'string' &&
    id.length > DEVICE_SECRET_PREFIX.length &&
    id.startsWith(DEVICE_SECRET_PREFIX)
  )
}

/**
 * Whether an id is under the reserved prefix at all — any device's token, this one's or not, and
 * whether or not a setting names it. Such an id is never read through the ordinary road, never
 * moved into the synced store and never packed into a transfer (pi review #4): a provider's key
 * id pointed at one, by an import or a hand edit, would otherwise carry a token that opens the
 * whole vault to wherever that road goes.
 */
export function isReservedSecretId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.toLowerCase().startsWith(DEVICE_SECRET_PREFIX)
}
