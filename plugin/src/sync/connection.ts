/**
 * This device's connection to a sync server, kept where no file can carry it.
 *
 * Where the server is, which vault and device this one enrolled as, the keychain name its token
 * is filed under, whether it is paused, and what of the vault it takes. All of it describes this
 * device and nothing else — and `data.json`, where it used to live, is exactly what a Finder
 * copy, a synced settings file or a transfer hands to another device. One that arrived that way
 * made two devices one identity on the server, or connected a copy of a vault nobody had set up.
 *
 * So it is filed the way the ledger id is (`ledgerId.ts`): in the vault's local storage, which
 * Obsidian scopes by the app's own id for the vault, and which a copied folder does not share.
 * The keychain is not the same thing everywhere: on a desktop Obsidian files it in that same
 * local storage, per vault; on a phone it is the system's secure storage, one for the whole app,
 * which every vault on the phone reads.
 *
 * What this device syncs is here too, the size cap with it: two devices on one vault may each
 * take a different half of it, which is how the cap on a phone came to be at all.
 */
import { selectiveDefaults, type SelectiveSettings } from '@abele/sync-core'
import { serverUrlProblem } from '@abele/sync-protocol'
import { DEVICE_SECRET_PREFIX, isDeviceSecretId } from '@/secrets/deviceSecret'
import { readLedgerId, type LocalStorage } from './ledgerId'
import { joinFrom, type JoinState } from './joinState'

export type { JoinState } from './joinState'

/** The key the record is filed under in this vault's local storage. */
export const CONNECTION_KEY = 'abele-sync-connection'

/**
 * What a phone syncs at most unless it was told otherwise. A vault's video and its scans are
 * what fill a phone up, and a device that skips them still has every note.
 */
export const MOBILE_MAX_FILE_BYTES = 50 * 1024 * 1024

export interface DeviceConnection {
  /**
   * `https://sync.example.com`, with no trailing slash; plain http only to a server on this
   * device (`serverUrlProblem`). Empty means not set up.
   */
  serverUrl: string
  /**
   * The address the device token was minted on. Only a sign-in and a transfer write it; an edit
   * to `serverUrl` leaves it where it was, so a Disconnect tells the server that can revoke the
   * token rather than whatever the address says now — and reads "not a token of ours" from
   * there as the truth it is.
   */
  enrolledUrl: string
  vaultId: string
  /** What the vault is called on the server, for saying so; empty when it was never told. */
  vaultName: string
  deviceId: string
  /** The keychain name the device token is filed under — never the token. */
  deviceTokenId: string
  /** What this device is called in the vault's device list. */
  deviceName: string
  /** Sync stays connected but moves nothing until this goes false again. */
  paused: boolean
  /** What this device takes of the vault, the size cap included. */
  selective: SelectiveSettings
  /**
   * Devices this one left while it could not reach the server, whose tokens it still holds to
   * tell the server with (`revoke.ts`).
   */
  pendingRevoke: PendingRevoke[]
  /**
   * A join this device is in the middle of, or null: see {@link JoinState}. Written by the
   * enrolment verbs alone, and cleared once a sync of the engine built with it gets through.
   */
  join: JoinState | null
  /**
   * Set once the connection has been moved out of `data.json`. Every record written says so
   * (`writeConnection`), and the move looks for a record at all rather than for this.
   */
  migrated: boolean
}

/**
 * A Disconnect the server has not heard of yet.
 *
 * The token is kept, under a keychain id of its own (`abele-sync-device-revoke-…`) so that a
 * reconnect — which reuses `deviceTokenId` — cannot pick it up, and tried again until the server
 * answers or a month has passed.
 */
export interface PendingRevoke {
  /** Where to tell: the address the token was minted on. */
  serverUrl: string
  deviceId: string
  deviceName: string
  tokenId: string
  /** When the device left, as an ISO date. */
  since: string
  /**
   * The address is plain http to another machine — a connection made before the https rule —
   * so the server is never told: the token is not sent over the network readable. Kept so the
   * Sync tab can say so until the person forgets it; never retried, never given up on its own.
   */
  plainHttp: boolean
}

/** How every keychain id of a token waiting to be revoked starts. */
export const REVOKE_SECRET_PREFIX = `${DEVICE_SECRET_PREFIX}revoke-`

/** Whether an id is one a waiting revoke is filed under: the prefix and something after it. */
export function isRevokeSecretId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > REVOKE_SECRET_PREFIX.length &&
    id.startsWith(REVOKE_SECRET_PREFIX)
  )
}

/** The selective settings a device starts with: everything, and on a phone a size cap. */
export function defaultSelective(isMobile = false): SelectiveSettings {
  const selective = selectiveDefaults()
  if (isMobile) selective.maxFileBytes = MOBILE_MAX_FILE_BYTES
  return selective
}

/** A device nobody has set up, and whose connection was never moved. */
export function emptyConnection(isMobile = false): DeviceConnection {
  return {
    serverUrl: '',
    enrolledUrl: '',
    vaultId: '',
    vaultName: '',
    deviceId: '',
    deviceTokenId: '',
    deviceName: '',
    paused: false,
    selective: defaultSelective(isMobile),
    pendingRevoke: [],
    join: null,
    migrated: false,
  }
}

/**
 * The record as it stands, checked field by field the way `data.json` always was: local storage
 * is harder to reach than a file, but an older build, a hand in the developer console or a
 * half-written record can all leave something the engine cannot run on.
 *
 * A keychain id this plugin never mints reads as none: pointed at a provider's key, it would
 * send that key to the server as a bearer token. `isMobile` decides only the defaults, so a
 * phone whose record names no cap gets the phone's.
 */
export function readConnection(storage: LocalStorage, isMobile = false): DeviceConnection {
  return inspectConnection(storage, isMobile).connection
}

/**
 * The record, and which of its fields were there but could not be taken — `record` when what is
 * stored is not a record at all. A missing field is not damage: it reads as its default, the way
 * a record written before the field existed should.
 *
 * Kept apart so the service can say it: a record that lost its token id reads as a device nobody
 * set up, and without a word the person would only see the sign-in card come back.
 */
export function inspectConnection(
  storage: LocalStorage,
  isMobile = false
): { connection: DeviceConnection; damaged: string[] } {
  const empty = emptyConnection(isMobile)
  const raw = storage.loadLocalStorage(CONNECTION_KEY)
  const o = objectOf(raw)
  if (o === null) return { connection: empty, damaged: raw === null ? [] : ['record'] }
  const damaged: string[] = []
  const text = (field: string): string => {
    if (o[field] !== undefined && typeof o[field] !== 'string') damaged.push(field)
    return stringOr(o[field], '')
  }
  const serverUrl = text('serverUrl')
  const vaultId = text('vaultId')
  const deviceId = text('deviceId')
  let deviceTokenId = text('deviceTokenId')
  // A waiting revoke's token is a device's that left: synced on, it would come back to life.
  if (
    deviceTokenId !== '' &&
    (!isDeviceSecretId(deviceTokenId) || isRevokeSecretId(deviceTokenId))
  ) {
    damaged.push('deviceTokenId')
    deviceTokenId = ''
  }
  const deviceName = text('deviceName')
  // A record from before the field was the device's own sign-in's, which wrote both at once.
  const enrolledUrl = o.enrolledUrl === undefined ? serverUrl : text('enrolledUrl')
  const vaultName = text('vaultName')
  if (o.paused !== undefined && typeof o.paused !== 'boolean') damaged.push('paused')
  if (o.selective !== undefined && objectOf(o.selective) === null) damaged.push('selective')
  const pending = pendingFrom(o.pendingRevoke)
  if (pending.damaged) damaged.push('pendingRevoke')
  const join = joinFrom(o.join, vaultId)
  if (join.damaged) damaged.push('join')
  return {
    connection: {
      serverUrl,
      enrolledUrl,
      vaultId,
      vaultName,
      deviceId,
      deviceTokenId,
      deviceName,
      paused: boolOr(o.paused, false),
      selective: selectiveFrom(o.selective, isMobile),
      pendingRevoke: pending.entries,
      join: join.join,
      migrated: o.migrated === true,
    },
    damaged,
  }
}

/**
 * Written whole, through JSON: nothing held in memory is shared with what is stored. Always as
 * moved — whoever wrote it, this is the device's own now, and the one-time move out of
 * `data.json` must never run over it.
 */
export function writeConnection(storage: LocalStorage, connection: DeviceConnection): void {
  const record = { ...connection, migrated: true }
  storage.saveLocalStorage(CONNECTION_KEY, JSON.parse(JSON.stringify(record)) as unknown)
}

/**
 * Why a connection may not be saved, or null when it may. The same rules the sign-in holds a
 * server address to, and the one the token read holds a keychain name to — so a connection
 * written by the agent, a transfer or a screen can say nothing the sign-in could not.
 */
export function connectionProblem(connection: DeviceConnection): string | null {
  if (connection.serverUrl !== '') {
    const problem = serverUrlProblem(connection.serverUrl)
    if (problem !== null) return problem
  }
  if (connection.deviceTokenId !== '' && !isDeviceSecretId(connection.deviceTokenId)) {
    return `a device token is only ever filed under a name that starts with ${DEVICE_SECRET_PREFIX}`
  }
  if (isRevokeSecretId(connection.deviceTokenId)) {
    return "that keychain name holds a token kept to tell a server a device left, not this device's own"
  }
  return null
}

/**
 * What the one-time move out of `data.json` found:
 * - `moved`: the file was this device's own, and its connection is now here;
 * - `dropped`: the file named a connection this device's keychain has no token for — another
 *   device's, carried in by a copy, a sync or a transfer — and it was not adopted;
 * - `fresh`: the file named no connection at all.
 *
 * `rewrite` says the file still holds fields that are no longer its own, and the caller should
 * write it again without them. Never when `stored` is false: the record did not read back as
 * written — Obsidian swallows a failed local-storage write, a full quota on a phone among them —
 * and the file is then the only copy of the connection there is.
 */
export interface Migration {
  outcome: 'moved' | 'dropped' | 'fresh'
  rewrite: boolean
  stored: boolean
}

/** What the log says about each outcome of the move. */
export const MIGRATION_LINE: Record<Migration['outcome'], string> = {
  moved: "moved this device's connection out of data.json into the vault's local storage",
  dropped:
    'data.json named a connection this vault was never set up with here (no ledger for that ' +
    'vault, or no token for it in the keychain); it was not adopted, and this device is not ' +
    'connected',
  fresh: 'data.json named no connection; nothing to move',
}

/** What the log says when the record did not read back, and the file was left as it was. */
export const MIGRATION_UNSTORED =
  "the connection could not be written to this vault's local storage; data.json was left as it " +
  'was, and the move is tried again at the next launch'

/**
 * Moves this device's connection out of the `sync` block `data.json` held, once.
 *
 * The identity is adopted only when this vault's local storage holds a ledger for the vault the
 * block names, and the keychain holds a token under the id it names. The ledger is the proof
 * that is certainly this vault's: enrolling writes it, local storage is per vault everywhere, and
 * a copy of the folder starts without one. The keychain is the proof that the token is here at
 * all — but only on a desktop is it per vault too; on a phone it is one for the whole app, so a
 * copied vault there would find the token and pass on that alone. A block that fails either is
 * dropped, which is what stops a copy of a vault from syncing as the device it was copied from.
 *
 * What the device syncs is taken either way, as a starting point: until now every device's
 * `data.json` was its own, so the switches in it are the ones this person last chose here or on
 * the device the file came from. The size cap is the exception — it follows the platform unless
 * the file passed the check, since a desktop's "no cap" handed to a phone is a phone filled up.
 *
 * Any record already stored means the move was made, whatever it says: one written without the
 * flag, or one gone bad, is still this device's, and running the move over it would replace a
 * live connection with whatever the file named — by then, nothing.
 *
 * The caller decides whether there is a file to move from at all: one that was missing or could
 * not be read is not the same as one that named nothing, and the move is not made off it.
 *
 * @param holdsToken whether this device's keychain holds a token under an id; only ever asked
 *   about an id this plugin mints, and only once the ledger check has passed.
 * @returns null when a record was already there.
 */
export function migrateConnection(
  storage: LocalStorage,
  legacy: unknown,
  holdsToken: (id: string) => boolean,
  isMobile = false
): Migration | null {
  if (storage.loadLocalStorage(CONNECTION_KEY) !== null) return null
  const o = objectOf(legacy) ?? {}
  const tokenId = stringOr(o.deviceTokenId, '')
  const vaultId = stringOr(o.vaultId, '')
  const own =
    isDeviceSecretId(tokenId) &&
    vaultId !== '' &&
    readLedgerId(storage).vaultId === vaultId &&
    holdsToken(tokenId)
  const selective = selectiveFrom(o.selective, isMobile)
  if (!own) selective.maxFileBytes = defaultSelective(isMobile).maxFileBytes

  const named = ['serverUrl', 'vaultId', 'deviceId', 'deviceTokenId'].some(
    (field) => stringOr(o[field], '') !== ''
  )
  const record: DeviceConnection = own
    ? {
        ...emptyConnection(isMobile),
        serverUrl: stringOr(o.serverUrl, ''),
        enrolledUrl: stringOr(o.serverUrl, ''),
        vaultId,
        deviceId: stringOr(o.deviceId, ''),
        deviceTokenId: tokenId,
        deviceName: stringOr(o.deviceName, ''),
        paused: boolOr(o.paused, false),
        selective,
        migrated: true,
      }
    : { ...emptyConnection(isMobile), selective, migrated: true }
  let stored = false
  try {
    writeConnection(storage, record)
    const back = objectOf(storage.loadLocalStorage(CONNECTION_KEY))
    stored = back !== null && JSON.stringify(back) === JSON.stringify(record)
  } catch {
    // Startup must leave the only legacy copy intact even when storage throws, not only
    // when it silently drops the write. The caller acknowledges migration only on success.
  }
  return {
    outcome: own ? 'moved' : named ? 'dropped' : 'fresh',
    rewrite: stored && Object.keys(o).some((field) => field !== 'keySignature'),
    stored,
  }
}

/**
 * Selective settings from whatever held them, filled out from the defaults switch by switch.
 *
 * `null` is a cap of its own — no cap — so it is kept where a missing field is not: a person
 * who turned the cap off on a phone is not given it back on the next launch.
 */
export function selectiveFrom(raw: unknown, isMobile = false): SelectiveSettings {
  const defaults = defaultSelective(isMobile)
  const o = objectOf(raw)
  if (o === null) return defaults
  const settings = objectOf(o.settings) ?? {}
  return {
    images: boolOr(o.images, defaults.images),
    audio: boolOr(o.audio, defaults.audio),
    video: boolOr(o.video, defaults.video),
    pdf: boolOr(o.pdf, defaults.pdf),
    other: boolOr(o.other, defaults.other),
    excludedFolders: Array.isArray(o.excludedFolders)
      ? o.excludedFolders.filter((folder): folder is string => typeof folder === 'string')
      : defaults.excludedFolders,
    maxFileBytes:
      o.maxFileBytes === null
        ? null
        : typeof o.maxFileBytes === 'number' && Number.isFinite(o.maxFileBytes)
          ? o.maxFileBytes
          : defaults.maxFileBytes,
    settings: {
      main: boolOr(settings.main, defaults.settings.main),
      appearance: boolOr(settings.appearance, defaults.settings.appearance),
      hotkeys: boolOr(settings.hotkeys, defaults.settings.hotkeys),
      corePlugins: boolOr(settings.corePlugins, defaults.settings.corePlugins),
      communityPlugins: boolOr(settings.communityPlugins, defaults.settings.communityPlugins),
      pluginSettings: boolOr(settings.pluginSettings, defaults.settings.pluginSettings),
    },
  }
}

/**
 * The waiting revokes a record holds, each taken only whole: an entry filed under anything but a
 * revoke id would have the retry send some other secret to a server, and delete it after. A date
 * that does not read is taken as the start of time, so the entry is given up at the next retry
 * rather than kept for ever.
 */
function pendingFrom(raw: unknown): { entries: PendingRevoke[]; damaged: boolean } {
  if (raw === undefined) return { entries: [], damaged: false }
  if (!Array.isArray(raw)) return { entries: [], damaged: true }
  const entries: PendingRevoke[] = []
  for (const item of raw) {
    const o = objectOf(item)
    const fields = ['serverUrl', 'deviceId', 'deviceName'] as const
    if (o === null || !isRevokeSecretId(o.tokenId)) continue
    if (fields.some((field) => typeof o[field] !== 'string')) continue
    const since = typeof o.since === 'string' ? Date.parse(o.since) : NaN
    entries.push({
      serverUrl: o.serverUrl as string,
      deviceId: o.deviceId as string,
      deviceName: o.deviceName as string,
      tokenId: o.tokenId,
      since: new Date(Number.isNaN(since) ? 0 : since).toISOString(),
      plainHttp: o.plainHttp === true,
    })
  }
  return { entries, damaged: entries.length !== raw.length }
}

const KIND_KEYS = ['images', 'audio', 'video', 'pdf', 'other'] as const
const SETTINGS_KEYS = [
  'main',
  'appearance',
  'hotkeys',
  'corePlugins',
  'communityPlugins',
  'pluginSettings',
] as const

/**
 * Why selective settings from outside may not be written, or null when they may: the Sync
 * tab's rules, for a writer that has no tab to hold it to them. Every field is there and of its
 * type, and nothing else is; the cap is no cap (`null`) or a positive whole number of bytes, on
 * a phone as on a desktop. `selectiveFrom` fills in and drops silently, which is right for a
 * record read back and wrong for a change somebody asked for and is told was made.
 *
 * The cap is judged only when it changes: one saved before this rule still lets the switches
 * beside it be flipped, the way `ConnectionKeeper.check` leaves a saved address alone.
 */
export function selectiveProblem(raw: unknown, saved: SelectiveSettings): string | null {
  const o = objectOf(raw)
  if (o === null) return 'selective has to be an object'
  const known = new Set<string>([...KIND_KEYS, 'excludedFolders', 'maxFileBytes', 'settings'])
  const unknown = Object.keys(o).filter((key) => !known.has(key))
  if (unknown.length > 0) return `selective has no ${unknown.join(', ')}`
  for (const key of KIND_KEYS) {
    if (typeof o[key] !== 'boolean') return `selective.${key} has to be true or false`
  }
  const folders = o.excludedFolders
  if (!Array.isArray(folders) || folders.some((folder) => typeof folder !== 'string')) {
    return 'selective.excludedFolders has to be a list of folder names'
  }
  const cap = o.maxFileBytes
  if (cap !== saved.maxFileBytes && cap !== null) {
    if (typeof cap !== 'number' || !Number.isSafeInteger(cap) || cap <= 0) {
      return 'selective.maxFileBytes has to be a positive whole number of bytes, or null for no cap'
    }
  }
  const settings = objectOf(o.settings)
  if (settings === null) return 'selective.settings has to be an object'
  const extra = Object.keys(settings).filter(
    (key) => !(SETTINGS_KEYS as readonly string[]).includes(key)
  )
  if (extra.length > 0) return `selective.settings has no ${extra.join(', ')}`
  for (const key of SETTINGS_KEYS) {
    if (typeof settings[key] !== 'boolean')
      return `selective.settings.${key} has to be true or false`
  }
  return null
}

/** A plain object to read fields off, or nothing — arrays and `null` are not records. */
export function objectOf(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function stringOr(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw : fallback
}

function boolOr(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}
