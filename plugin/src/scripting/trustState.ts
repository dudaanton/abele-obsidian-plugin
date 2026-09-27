/**
 * Which versions of the scripts this device vouches for — the state behind "a script that
 * arrived from elsewhere waits to be confirmed", as plain data and pure functions.
 *
 * Obsidian says `modify` the same way for a save made here and for a change Obsidian Sync,
 * iCloud, Syncthing or git brought in; Obsidian Sync even writes through the very vault calls
 * the plugin uses. So where a change came from is never read off an event. What is kept instead
 * is the other half: every version of a script this device wrote, or the person confirmed here,
 * by a SHA-256 of its whole text. A script whose text is not among them is from elsewhere.
 *
 * - Per path, the last version vouched for: its hash, and its text for the diff the review
 *   dialog shows (left out past `MAX_TEXT`, where the dialog shows the whole code instead).
 * - A version vouched for at one path vouches for it at any path: a script renamed or copied
 *   here, or by a sync, is the same code.
 * - `armed` is whether this device checks at all. It is kept here, beside the record, rather
 *   than read from the settings: those live in the vault and travel with it, so a switch turned
 *   off by what synced would switch off the one thing meant to stand up to what syncs.
 * - `declined` is the switch turned off *on this device*. The setting arriving on from another
 *   device arms a device that never said anything; one that said no stays off until it is
 *   switched on here again.
 *
 * `ScriptTrust.ts` keeps this on the device and hashes; nothing here touches Obsidian.
 */

/** A version of a script: the SHA-256 of its whole file, and the file when it is not huge. */
export interface TrustRecord {
  hash: string
  text?: string
}

export interface TrustState {
  armed: boolean
  /** Switched off on this device: the setting arriving on does not arm it. */
  declined: boolean
  /** The last version vouched for, by path. */
  scripts: Record<string, TrustRecord>
  /** Versions a source refused outright; see `ScriptSourcePolicy`. */
  refused: string[]
}

/**
 * What a source that knows itself — a connection of Abele Sync, one day — says about the
 * scripts it brings: run them as they come, hold them until confirmed here, or never run what
 * it brought. Whatever does not say, arrives as `confirm`.
 */
export type ScriptSourcePolicy = 'accept' | 'confirm' | 'refuse'

export type TrustVerdict = 'confirmed' | 'waiting' | 'refused'

/** A script as the index holds it, as far as vouching is concerned. */
export interface TrustedFile {
  path: string
  hash: string
  text: string
}

/** Past this many characters the text of a version is not kept, only its hash. */
export const MAX_TEXT = 100_000
/** How many refused versions are remembered; the oldest go first. */
const MAX_REFUSED = 200

export const emptyTrust = (): TrustState => ({
  armed: false,
  declined: false,
  scripts: {},
  refused: [],
})

/** The state as stored, made whole: anything unreadable is dropped rather than trusted. */
export function trustStateFrom(stored: unknown): TrustState {
  if (!stored || typeof stored !== 'object') return emptyTrust()
  const raw = stored as {
    armed?: unknown
    declined?: unknown
    scripts?: unknown
    refused?: unknown
  }
  const scripts: Record<string, TrustRecord> = {}
  if (raw.scripts && typeof raw.scripts === 'object') {
    for (const [path, value] of Object.entries(raw.scripts as Record<string, unknown>)) {
      const record = value as { hash?: unknown; text?: unknown } | null
      if (!record || typeof record.hash !== 'string' || !record.hash) continue
      scripts[path] =
        typeof record.text === 'string'
          ? { hash: record.hash, text: record.text }
          : { hash: record.hash }
    }
  }
  const refused = Array.isArray(raw.refused)
    ? raw.refused.filter((h): h is string => typeof h === 'string' && !!h)
    : []
  const armed = raw.armed === true
  return { armed, declined: !armed && raw.declined === true, scripts, refused }
}

const record = (hash: string, text: string): TrustRecord =>
  text.length > MAX_TEXT ? { hash } : { hash, text }

function vouched(state: TrustState, hash: string): boolean {
  return Object.values(state.scripts).some((r) => r.hash === hash)
}

/** Whether the version `hash` of the script at `path` may run on this device. */
export function verdictOf(state: TrustState, path: string, hash: string | undefined): TrustVerdict {
  if (!state.armed) return 'confirmed'
  if (!hash) return 'waiting'
  if (state.refused.includes(hash)) return 'refused'
  if (state.scripts[path]?.hash === hash || vouched(state, hash)) return 'confirmed'
  return 'waiting'
}

/** Checking switched on: every script as it is now is taken as vouched for. */
export function armedWith(state: TrustState, files: TrustedFile[]): TrustState {
  const scripts = { ...state.scripts }
  for (const file of files) scripts[file.path] = record(file.hash, file.text)
  return { armed: true, declined: false, scripts, refused: state.refused }
}

/**
 * Checking switched off on this device: everything is forgotten, so switching it on again
 * starts afresh, and the setting arriving on from elsewhere no longer arms it.
 */
export const disarmed = (): TrustState => ({ ...emptyTrust(), declined: true })

/** Whether the setting, as it is in the settings file, should arm this device now. */
export const armsFromSettings = (state: TrustState, wanted: boolean): boolean =>
  wanted && !state.armed && !state.declined

/**
 * This version written here or confirmed here. Also takes it off the refused list: a person
 * who looked at it and said yes, or wrote it, outranks a source that said no.
 */
export function withConfirmed(
  state: TrustState,
  path: string,
  hash: string,
  text: string
): TrustState {
  if (!state.armed) return state
  return {
    ...state,
    scripts: { ...state.scripts, [path]: record(hash, text) },
    refused: state.refused.filter((h) => h !== hash),
  }
}

/** A version brought by a source with a policy of its own. */
export function withArrival(
  state: TrustState,
  path: string,
  hash: string,
  text: string,
  policy: ScriptSourcePolicy
): TrustState {
  if (!state.armed) return state
  if (policy === 'accept') return withConfirmed(state, path, hash, text)
  if (policy === 'refuse') {
    if (state.refused.includes(hash)) return state
    return { ...state, refused: [...state.refused, hash].slice(-MAX_REFUSED) }
  }
  return state
}

/**
 * The record brought in line with the scripts there are now.
 *
 * A script whose version is vouched for under another path — renamed, or copied — gets its
 * own entry, so it stays confirmed once the old path is gone. Paths no script has any more are
 * dropped. A waiting script keeps the entry it had: that is the version its diff is against.
 */
export function reconciled(state: TrustState, files: TrustedFile[]): TrustState {
  if (!state.armed) return state
  const scripts: Record<string, TrustRecord> = {}
  for (const file of files) {
    const own = state.scripts[file.path]
    if (own?.hash === file.hash) scripts[file.path] = own
    else if (vouched(state, file.hash) && !state.refused.includes(file.hash))
      scripts[file.path] = record(file.hash, file.text)
    else if (own) scripts[file.path] = own
  }
  return { ...state, scripts }
}

/** Whether two states would be stored the same. */
export function sameTrust(a: TrustState, b: TrustState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
