/**
 * How every id on the device-only road starts: the sync device token's, as the sync service
 * mints it. The id itself is read out of the settings, which an agent or another device's
 * `data.json` can write, so the road checks the name rather than trusting it — pointed at a
 * provider's key, it would otherwise send that key to a server and delete it on Disconnect.
 */
import { normalizeServerUrl, serverUrlProblem, PLAIN_HTTP_REFUSED } from '@abele/sync-protocol'

/** Identity comparison is separate from transport policy; legacy plain HTTP is never sent. */
function bindingServer(server: string): string | null {
  const allowed = normalizeServerUrl(server)
  if (allowed !== null) return allowed
  if (serverUrlProblem(server) !== PLAIN_HTTP_REFUSED) return null
  const parsed = new URL(server)
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

export const DEVICE_SECRET_PREFIX = 'abele-sync-device-'

interface DeviceRoad {
  get(id: string): string
  set(id: string, value: string): void
}

export const tokenServerId = (id: string): string => `${id}-server`

/** Binding is stored beside the token in the device-only keychain, shared by mobile vaults. */
export function bindDeviceToken(
  device: DeviceRoad,
  id: string,
  token: string,
  server: string
): void {
  const origin = bindingServer(server)
  if (!isDeviceSecretId(id) || origin === null) throw new Error('invalid device token binding')
  // The proof includes the exact value in one keychain entry. Two independent keychain
  // writes can otherwise persist an old token beside a new origin after an id is reused.
  const proof = JSON.stringify({ server: origin, token })
  device.set(tokenServerId(id), proof)
  device.set(id, token)
  if (device.get(tokenServerId(id)) !== proof || device.get(id) !== token)
    throw new Error('device token binding was not kept')
}

export function boundDeviceToken(device: DeviceRoad, id: string, server: string): string | null {
  if (!isDeviceSecretId(id)) return null
  const origin = bindingServer(server)
  const raw = device.get(tokenServerId(id))
  if (origin === null || raw === '') return null
  let binding: { server?: unknown; token?: unknown }
  try {
    const read: unknown = JSON.parse(raw)
    if (read === null || typeof read !== 'object') return null
    binding = read as typeof binding
  } catch {
    return null
  }
  const token = device.get(id)
  if (
    typeof binding.server !== 'string' ||
    bindingServer(binding.server) !== origin ||
    binding.token !== token
  )
    return null
  return token === '' ? null : token
}

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
