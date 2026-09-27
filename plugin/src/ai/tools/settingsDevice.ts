import { SyncService } from '@/sync/SyncService'

/**
 * This device's sync connection, as the settings tools reach it.
 *
 * The connection is not in `data.json` and not on `AbeleConfig`: it is a record in the vault's
 * local storage (`sync/connection.ts`). So the tools keep a small table of *device paths* under
 * `sync` — the fields an agent could write while they were settings, and no others (GUESS-8) —
 * and read them from `SyncService.connection` and write them through `updateConnection`, which
 * holds the https rule, the keychain-name rule and the token's own server for every writer.
 *
 * What the bookkeeping owns — the address the token was minted on, the revokes still waiting,
 * the move flag — is not in the table, so it is neither read nor written from here.
 */

/** The connection's fields an agent reaches as `sync.<field>`. */
const DEVICE_FIELDS = [
  'serverUrl',
  'vaultId',
  'deviceId',
  'deviceTokenId',
  'deviceName',
  'paused',
  'selective',
] as const

type DeviceField = (typeof DEVICE_FIELDS)[number]

/** The fields that decide which server this device's token is sent to, and as whom. */
const MOVES_TOKEN: ReadonlySet<string> = new Set([
  'serverUrl',
  'vaultId',
  'deviceId',
  'deviceTokenId',
])

function fieldOf(path: string): DeviceField | null {
  const [root, field] = path.split('.')
  if (root !== 'sync' || field === undefined) return null
  return (DEVICE_FIELDS as readonly string[]).includes(field) ? (field as DeviceField) : null
}

/** Whether `path` is one of this device's connection fields, or something under one. */
export function isDevicePath(path: string): boolean {
  return fieldOf(path) !== null
}

/** The device fields as plain data: a copy, never the reactive record itself. */
export function deviceView(): Record<string, unknown> {
  const connection = SyncService.getInstance().connection.value
  const view: Record<string, unknown> = {}
  for (const field of DEVICE_FIELDS) {
    view[field] = JSON.parse(JSON.stringify(connection[field])) as unknown
  }
  return view
}

/**
 * The value at a device path, walked on a copy of the view — `sync.selective.images` — or
 * undefined when the path names nothing.
 */
export function deviceValue(path: string): unknown {
  let holder: unknown = deviceView()
  for (const segment of path.split('.').slice(1)) {
    if (!holder || typeof holder !== 'object') return undefined
    holder = (holder as Record<string, unknown>)[segment]
  }
  return holder
}

/**
 * Writes one device path through `updateConnection`, and answers with its refusal, or null
 * when it was written.
 *
 * A field is replaced whole; a path inside `selective` replaces `selective` with a copy that
 * has that one value changed, so the rest of what this device takes stays as it was.
 */
export async function writeDevice(path: string, next: unknown): Promise<string | null> {
  const field = fieldOf(path)
  if (field === null) return `"${path}" is not a field of this device's connection.`
  const rest = path.split('.').slice(2)
  let value: unknown = next
  if (rest.length > 0) {
    const copy = deviceView()[field] as Record<string, unknown>
    let holder = copy
    for (const segment of rest.slice(0, -1)) holder = holder[segment] as Record<string, unknown>
    holder[rest[rest.length - 1]] = next
    value = copy
  }
  try {
    await SyncService.getInstance().updateConnection({ [field]: value })
    return null
  } catch (error) {
    return `"${path}" was not changed: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** The host an address names, or the address itself when it is not one a URL parser reads. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/**
 * The line the approval card adds for a device path: a warning for a field that moves this
 * device's token — naming where it would be sent — and null for any other.
 */
export function deviceWarning(path: string, next: unknown): string | null {
  const field = fieldOf(path)
  if (field === null || !MOVES_TOKEN.has(field)) return null
  const server =
    field === 'serverUrl' && typeof next === 'string'
      ? next
      : SyncService.getInstance().connection.value.serverUrl
  const where = server === '' ? 'whichever server this device is set to' : hostOf(server)
  return `Changes where this device syncs. Its device token will be sent to ${where}.`
}
