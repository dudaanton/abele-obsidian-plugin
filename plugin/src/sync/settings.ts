/**
 * What `data.json` holds about syncing: only what every device on the vault shares.
 *
 * This device's connection — the server, the vault, the device it enrolled as, the keychain
 * name of its token, the pause switch and what of the vault it takes — is not here. It is filed
 * in the vault's local storage (`connection.ts`), because `data.json` is exactly what a copy of
 * the vault, a synced settings file or a transfer hands to another device.
 */
import { migrateSharingCatalogue, type SharingCatalogueEntry } from './sharing/sharingCatalogue'
export interface SyncSettings {
  /** Bound, portable sharing discovery. No credentials, decisions or local ledger identity. */
  sharing: SharingCatalogueEntry[]
  /**
   * The frontmatter property and value a note must carry to be encrypted. Stored from this
   * phase on, applied from the next: nothing reads it yet.
   */
  keySignature: { property: string; value: string } | null
}

/** A fresh set of settings, safe to mutate. */
export function defaultSyncSettings(): SyncSettings {
  return { keySignature: null, sharing: [] }
}

/** The defaults, for reading. Call `defaultSyncSettings()` for a set to edit. */
export const DEFAULT_SYNC_SETTINGS: SyncSettings = Object.freeze(defaultSyncSettings())

/**
 * Settings as read off disk: whatever `data.json` held, turned into settings this plugin can
 * run on.
 *
 * Every field is checked rather than trusted. A settings file is a plain file in a vault that
 * a person edits, that an older version of this plugin wrote, and that another device's sync
 * may have brought in — so a missing field takes its default, a field of the wrong type takes
 * its default too, and anything not named here is dropped rather than carried along. That is
 * also how a connection an older build wrote into the file stops being read: it is dropped on
 * the way in and never written back, and only the one-time move in `connection.ts`, handed the
 * block as it was loaded, ever looks at it.
 */
export function migrateSyncSettings(raw: unknown): SyncSettings {
  const o = objectOf(raw)
  if (o === null) return defaultSyncSettings()
  const sharing = migrateSharingCatalogue(o.sharing)
  return { keySignature: migrateKeySignature(o.keySignature), sharing: sharing ?? [] }
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
