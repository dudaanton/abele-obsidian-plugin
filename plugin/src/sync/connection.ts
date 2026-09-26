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
 * Obsidian scopes by the app's own id for the vault — the same place it keeps the vault's
 * keychain, and something a copied folder does not share.
 *
 * What this device syncs is here too, the size cap with it: two devices on one vault may each
 * take a different half of it, which is how the cap on a phone came to be at all.
 */
import { selectiveDefaults, type SelectiveSettings } from '@abele/sync-core'
import { serverUrlProblem } from '@abele/sync-protocol'
import { DEVICE_SECRET_PREFIX, isDeviceSecretId } from '@/secrets/deviceSecret'
import type { LocalStorage } from './ledgerId'

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
  vaultId: string
  deviceId: string
  /** The keychain name the device token is filed under — never the token. */
  deviceTokenId: string
  /** What this device calls itself in the vault's device list. */
  deviceName: string
  /** Sync stays connected but moves nothing until this goes false again. */
  paused: boolean
  /** What this device takes of the vault, the size cap included. */
  selective: SelectiveSettings
  /** Set once the connection has been moved out of `data.json`; the move never runs again. */
  migrated: boolean
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
    vaultId: '',
    deviceId: '',
    deviceTokenId: '',
    deviceName: '',
    paused: false,
    selective: defaultSelective(isMobile),
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
  const empty = emptyConnection(isMobile)
  const o = objectOf(storage.loadLocalStorage(CONNECTION_KEY))
  if (o === null) return empty
  const tokenId = stringOr(o.deviceTokenId, '')
  return {
    serverUrl: stringOr(o.serverUrl, ''),
    vaultId: stringOr(o.vaultId, ''),
    deviceId: stringOr(o.deviceId, ''),
    deviceTokenId: isDeviceSecretId(tokenId) ? tokenId : '',
    deviceName: stringOr(o.deviceName, ''),
    paused: boolOr(o.paused, false),
    selective: selectiveFrom(o.selective, isMobile),
    migrated: o.migrated === true,
  }
}

/** Written whole, through JSON: nothing held in memory is shared with what is stored. */
export function writeConnection(storage: LocalStorage, connection: DeviceConnection): void {
  storage.saveLocalStorage(CONNECTION_KEY, JSON.parse(JSON.stringify(connection)) as unknown)
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
 * write it again without them.
 */
export interface Migration {
  outcome: 'moved' | 'dropped' | 'fresh'
  rewrite: boolean
}

/**
 * Moves this device's connection out of the `sync` block `data.json` held, once.
 *
 * The identity is adopted only when this keychain holds a token under the id the block names.
 * The keychain is per vault and per device, so only the device that enrolled holds it; a block
 * that came from anywhere else fails and is dropped, which is what stops a copy of a vault from
 * syncing as the device it was copied from.
 *
 * What the device syncs is taken either way, as a starting point: until now every device's
 * `data.json` was its own, so the switches in it are the ones this person last chose here or on
 * the device the file came from. The size cap is the exception — it follows the platform unless
 * the file passed the check, since a desktop's "no cap" handed to a phone is a phone filled up.
 *
 * @param holdsToken whether this device's keychain holds a token under an id; only ever asked
 *   about an id this plugin mints.
 * @returns null when the record says the move was already made.
 */
export function migrateConnection(
  storage: LocalStorage,
  legacy: unknown,
  holdsToken: (id: string) => boolean,
  isMobile = false
): Migration | null {
  if (readConnection(storage, isMobile).migrated) return null
  const o = objectOf(legacy) ?? {}
  const tokenId = stringOr(o.deviceTokenId, '')
  const own = isDeviceSecretId(tokenId) && holdsToken(tokenId)
  const selective = selectiveFrom(o.selective, isMobile)
  if (!own) selective.maxFileBytes = defaultSelective(isMobile).maxFileBytes

  const named = ['serverUrl', 'vaultId', 'deviceId', 'deviceTokenId'].some(
    (field) => stringOr(o[field], '') !== ''
  )
  const record: DeviceConnection = own
    ? {
        serverUrl: stringOr(o.serverUrl, ''),
        vaultId: stringOr(o.vaultId, ''),
        deviceId: stringOr(o.deviceId, ''),
        deviceTokenId: tokenId,
        deviceName: stringOr(o.deviceName, ''),
        paused: boolOr(o.paused, false),
        selective,
        migrated: true,
      }
    : { ...emptyConnection(isMobile), selective, migrated: true }
  writeConnection(storage, record)
  return {
    outcome: own ? 'moved' : named ? 'dropped' : 'fresh',
    rewrite: Object.keys(o).some((field) => field !== 'keySignature'),
  }
}

/**
 * Selective settings from whatever held them, filled out from the defaults switch by switch.
 *
 * `null` is a cap of its own — no cap — so it is kept where a missing field is not: a person who
 * turned the cap off on a phone is not given it back on the next launch.
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
