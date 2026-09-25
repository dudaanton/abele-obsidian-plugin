import { selectiveDefaults, type SelectiveSettings } from '@abele/sync-core'

/**
 * What one device remembers about syncing: where the server is, which vault and device it
 * enrolled as, and what of the vault it takes.
 *
 * The device token itself is never here — only `deviceTokenId`, the key it is filed under in
 * Obsidian's secret storage. These settings are written to `data.json` in the vault, and a
 * vault is exactly what a sync sends to another machine.
 */
export interface SyncSettings {
  /** Scheme and host, no trailing path: `https://sync.example.com`. Empty means not set up. */
  serverUrl: string
  vaultId: string
  deviceId: string
  /** The key the device token is stored under, not the token. */
  deviceTokenId: string
  /** What this device calls itself in the vault's device list. */
  deviceName: string
  selective: SelectiveSettings
  /** Sync stays connected but moves nothing until this goes false again. */
  paused: boolean
  /**
   * The frontmatter property and value a note must carry to be encrypted. Stored from this
   * phase on, applied from the next: nothing reads it yet.
   */
  keySignature: { property: string; value: string } | null
}

/**
 * What a phone syncs at most by default. A vault's video and its scans are what fill a phone
 * up, and a device that skips them still has every note.
 */
export const MOBILE_MAX_FILE_BYTES = 50 * 1024 * 1024

/**
 * A fresh set of settings, safe to mutate.
 *
 * The size cap is the only thing the platform decides, and it is decided here rather than at
 * the point of use so that both callers — a first run and a settings file with no `sync` in
 * it — get the same answer. The caller passes `Platform.isMobile`; nothing in this module
 * imports the plugin API, which is what lets it be tested on its own.
 */
export function defaultSyncSettings(isMobile = false): SyncSettings {
  const selective = selectiveDefaults()
  if (isMobile) selective.maxFileBytes = MOBILE_MAX_FILE_BYTES
  return {
    serverUrl: '',
    vaultId: '',
    deviceId: '',
    deviceTokenId: '',
    deviceName: '',
    selective,
    paused: false,
    keySignature: null,
  }
}

/** The desktop defaults, for reading. Call `defaultSyncSettings()` for a set to edit. */
export const DEFAULT_SYNC_SETTINGS: SyncSettings = deepFreeze(defaultSyncSettings())

/**
 * Settings as read off disk: whatever `data.json` held, turned into settings this plugin can
 * run on.
 *
 * Every field is checked rather than trusted. A settings file is a plain file in a vault that
 * a person edits, that an older version of this plugin wrote, and that another device's sync
 * may have brought in — so a missing field takes its default, a field of the wrong type takes
 * its default too, and anything not named here is dropped rather than carried along.
 *
 * `isMobile` decides only the defaults, so a phone opening a vault for the first time gets
 * the size cap while a phone whose settings already name one keeps what it was told.
 */
export function migrateSyncSettings(raw: unknown, isMobile = false): SyncSettings {
  const defaults = defaultSyncSettings(isMobile)
  const o = objectOf(raw)
  if (o === null) return defaults
  return {
    serverUrl: stringOr(o.serverUrl, defaults.serverUrl),
    vaultId: stringOr(o.vaultId, defaults.vaultId),
    deviceId: stringOr(o.deviceId, defaults.deviceId),
    deviceTokenId: stringOr(o.deviceTokenId, defaults.deviceTokenId),
    deviceName: stringOr(o.deviceName, defaults.deviceName),
    selective: migrateSelective(o.selective, defaults.selective),
    paused: typeof o.paused === 'boolean' ? o.paused : defaults.paused,
    keySignature: migrateKeySignature(o.keySignature),
  }
}

/**
 * The ledger id an older version of the plugin kept in `data.json`, or null when the block
 * holds none.
 *
 * Read once, to move it into the vault's local storage (`ledgerId.ts`), and never written back:
 * a file is exactly what a transfer, a copied vault or a file sync carries to another local
 * vault, and a ledger id that travels opens the other vault's ledger.
 */
export function legacyLedgerOf(raw: unknown): { stateId: string; vaultId: string } | null {
  const o = objectOf(raw)
  if (o === null || typeof o.stateId !== 'string' || o.stateId === '') return null
  return { stateId: o.stateId, vaultId: typeof o.stateVaultId === 'string' ? o.stateVaultId : '' }
}

/** Whether a stored block still names a ledger, so the file is due to be written without it. */
export function holdsLegacyLedger(raw: unknown): boolean {
  const o = objectOf(raw)
  return o !== null && ('stateId' in o || 'stateVaultId' in o)
}

/** The selective settings, filled out from the defaults switch by switch. */
function migrateSelective(raw: unknown, defaults: SelectiveSettings): SelectiveSettings {
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
    // `null` is a cap of its own — no cap — so it is kept where a missing field is not.
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

/** A signature is both halves or neither: half of one would name every note or none. */
function migrateKeySignature(raw: unknown): SyncSettings['keySignature'] {
  const o = objectOf(raw)
  if (o === null) return null
  if (typeof o.property !== 'string' || typeof o.value !== 'string') return null
  if (o.property === '') return null
  return { property: o.property, value: o.value }
}

/** A plain object to read fields off, or nothing — arrays and `null` are not settings. */
function objectOf(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function stringOr(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw : fallback
}

function boolOr(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

/** Frozen through, since every reader shares the one copy. */
function deepFreeze(settings: SyncSettings): SyncSettings {
  Object.freeze(settings.selective.excludedFolders)
  Object.freeze(settings.selective.settings)
  Object.freeze(settings.selective)
  return Object.freeze(settings)
}
