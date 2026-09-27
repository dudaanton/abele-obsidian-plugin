import { normalizeServerUrl } from '@abele/sync-protocol'
import { isPrototypeName } from '@/helpers/prototypeNames'
import { defaultSelective } from '@/sync/connection'
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

/**
 * Whether a settings path holds a segment that reaches a prototype (`PROTOTYPE_NAMES`): refused
 * before anything is read or written.
 */
export function reachesPrototype(path: string): boolean {
  return path.split('.').some(isPrototypeName)
}

/** The answer to a path that names no field at all. */
export const invalidPath = (path: string): string => `"${path}" is not a valid field path.`

/** Whether `object` has `key` of its own, not through its prototype. */
export function ownKey(object: unknown, key: string): boolean {
  return (
    typeof object === 'object' &&
    object !== null &&
    Object.prototype.hasOwnProperty.call(object, key)
  )
}

/**
 * Whether a device path names a field there is: `sync.<field>`, or a field the selective
 * settings have — `sync.selective.images`, `sync.selective.settings.main` — walked down their
 * own shape, with an index as the last step into the list of excluded folders. Every other
 * connection field is a plain value, with nothing under it.
 */
export function isValidDevicePath(path: string): boolean {
  if (reachesPrototype(path)) return false
  const field = fieldOf(path)
  if (field === null) return false
  const rest = path.split('.').slice(2)
  if (rest.length === 0) return true
  if (field !== 'selective') return false
  let shape: unknown = defaultSelective()
  for (const [at, segment] of rest.entries()) {
    if (Array.isArray(shape)) return at === rest.length - 1 && /^(0|[1-9]\d*)$/.test(segment)
    if (!ownKey(shape, segment)) return false
    shape = (shape as Record<string, unknown>)[segment]
  }
  return true
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
  if (!isValidDevicePath(path)) return undefined
  let holder: unknown = deviceView()
  for (const segment of path.split('.').slice(1)) {
    if (!ownKey(holder, segment)) return undefined
    holder = (holder as Record<string, unknown>)[segment]
  }
  return holder
}

/**
 * Writes one device path through `updateConnection`, and answers with its refusal, or null
 * when it was written. A path that names no field (`isValidDevicePath`) is refused before
 * anything is read.
 *
 * A field is replaced whole; a path inside `selective` replaces `selective` with a copy that
 * has that one value changed, so the rest of what this device takes stays as it was.
 */
export async function writeDevice(path: string, next: unknown): Promise<string | null> {
  const field = fieldOf(path)
  if (field === null) return `"${path}" is not a field of this device's connection.`
  if (!isValidDevicePath(path)) return invalidPath(path)
  const rest = path.split('.').slice(2)
  let value: unknown = next
  if (rest.length > 0) {
    // A copy made through JSON, so it holds its fields as its own and nothing else. Walked
    // only through what it holds itself, and the value defined rather than assigned, so no
    // setter anywhere up a prototype chain is ever reached.
    const copy = deviceView()[field] as Record<string, unknown>
    let holder = copy
    for (const segment of rest.slice(0, -1)) {
      const inner = ownKey(holder, segment) ? holder[segment] : undefined
      if (typeof inner !== 'object' || inner === null) return invalidPath(path)
      holder = inner as Record<string, unknown>
    }
    Object.defineProperty(holder, rest[rest.length - 1], {
      value: next,
      enumerable: true,
      writable: true,
      configurable: true,
    })
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
 * The types a device path takes, where they are not simply the type it holds now: the size cap
 * is a number or no cap at all, on a phone as on a desktop, as an empty field on the Sync tab
 * is. Null for every other path, which the ordinary type check covers.
 */
export function deviceTypes(path: string): readonly string[] | null {
  return path === 'sync.selective.maxFileBytes' ? ['number', 'empty'] : null
}

/**
 * The value a write would leave at a device path, as far as can be said before it runs: an
 * address the way it will be stored (`ConnectionKeeper.check`), anything else as asked.
 */
export function deviceNext(path: string, next: unknown): unknown {
  if (path !== 'sync.serverUrl' || typeof next !== 'string' || next === '') return next
  return normalizeServerUrl(next) ?? next
}

/**
 * Why sync is not running after a write that went through, or null when nothing says it failed:
 * the address named a vault the token is not enrolled on, the server did not answer. The
 * error status never carries a secret.
 */
export function startFailure(): string | null {
  const status = SyncService.getInstance().status.value
  return status.state === 'error' ? (status.lastError ?? 'no reason was given') : null
}

/**
 * The line the approval card adds for a device path: a warning for a field that moves this
 * device's token — naming where it would be sent — and null for any other.
 *
 * Emptying the address or the vault sends the token nowhere: the device stops syncing, and the
 * token it holds stays valid on the server it was minted on until Disconnect tells that server.
 */
export function deviceWarning(path: string, next: unknown): string | null {
  const field = fieldOf(path)
  if (field === null || !MOVES_TOKEN.has(field)) return null
  const connection = SyncService.getInstance().connection.value
  if ((field === 'serverUrl' || field === 'vaultId') && next === '') {
    const minted = connection.enrolledUrl || connection.serverUrl
    return minted === ''
      ? 'Stops this device syncing.'
      : `Stops this device syncing. Its device token stays valid on ${hostOf(minted)} until Disconnect.`
  }
  const server = field === 'serverUrl' && typeof next === 'string' ? next : connection.serverUrl
  const where = server === '' ? 'whichever server this device is set to' : hostOf(server)
  return `Changes where this device syncs. Its device token will be sent to ${where}.`
}
