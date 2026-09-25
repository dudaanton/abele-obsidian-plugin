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
