import type { App } from 'obsidian'
import {
  encodeText,
  settingsCategory,
  sha256,
  type SelectiveSettings,
  type SyncReport,
} from '@abele/sync-core'
import { DEVICE_SECRET_PREFIX } from '@/secrets/SecretStore'

/**
 * The small pieces the sync service and the enrolment verbs share: names, the lines the log
 * writes, the scope key, the ignore file read. None of them holds state.
 */

/** The meta key the scope is filed under, the same one the daemon uses. */
export const SCOPE_KEY = 'scope'

/** The vault's ignore file, read from its root. */
export const IGNORE_FILE = '.abele-sync-ignore'

/** What this plugin calls itself to a sync server. */
export const USER_AGENT = 'abele-obsidian-plugin'

export const noop = (): void => undefined

/** What a failure says. A thrown value that is neither an error nor text is shown as JSON. */
export const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? 'an unknown failure'
  } catch {
    return 'an unknown failure'
  }
}

/**
 * Whether this vault's config folder is the one the wire knows.
 *
 * Core's settings switches recognise a single name for it, and core is what is asked rather
 * than the name being spelled out here: a device whose config folder is called something else
 * keeps it out of the sync altogether (`isHidden`).
 */
export function isWireConfigDir(configDir: string): boolean {
  return settingsCategory(`${configDir}/app.json`) !== null
}

/** A keychain id: lowercase letters, digits and dashes, which is all Obsidian accepts. */
export function newSecretId(): string {
  return `${DEVICE_SECRET_PREFIX}${randomStem()}`
}

/** The name this device's ledger is filed under. Local to this vault and shown to nobody. */
export function newStateId(): string {
  return `${randomStem()}${randomStem()}`
}

export function randomStem(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0')
}

/**
 * Whether a wire path is one this device leaves alone because Obsidian cannot see it: any path
 * with a segment that starts with a dot, except the config folder when it is the one the wire
 * knows. Inside that folder the engine's own settings switches decide.
 */
export function isHidden(wirePath: string, configDir: string): boolean {
  if (!wirePath.split('/').some((segment) => segment.startsWith('.'))) return false
  return !(isWireConfigDir(configDir) && wirePath.startsWith(`${configDir}/`))
}

/** What the log says on a device whose config folder the sync does not carry. */
export function configLine(configDir: string): string {
  return (
    `the config folder here is ${configDir}, which sync does not know: ` +
    'Obsidian settings do not sync on this device, and nothing in either folder is touched'
  )
}

/** What the log says about the rules the engine was just built on. */
export function ignoreLine(ignoreText: string | null): string {
  if (ignoreText === null) return `no ${IGNORE_FILE} in this vault`
  const rules = ignoreText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#')).length
  return `${IGNORE_FILE}: ${rules} rule(s) in force`
}

/**
 * What this device syncs, as one short string: the selective settings and the ignore file
 * together, since a pattern dropped from `.abele-sync-ignore` widens the scope exactly as a
 * type switched on does. The daemon's key, computed the same way — through WebCrypto rather
 * than Node's, because this runs in a WebView.
 */
export async function scopeKey(
  selective: SelectiveSettings,
  ignoreText: string | null
): Promise<string> {
  return sha256(encodeText(JSON.stringify({ selective, ignore: ignoreText })))
}

/**
 * The vault's `.abele-sync-ignore` as it reads, or null when it has none.
 *
 * Through the adapter and as bytes: the file is at the vault root, but Obsidian's file index
 * hides a leading dot, so `vault.read` would never find it.
 *
 * Null only when the file is not there. One that is there and will not be read — locked, an
 * iCloud placeholder, a permissions slip — throws: syncing as if it were absent would upload
 * exactly what it keeps off the server, and `reconcile` turns the throw into an error status
 * with nothing running.
 */
export async function readIgnore(app: App): Promise<string | null> {
  try {
    if (!(await app.vault.adapter.exists(IGNORE_FILE))) return null
    return new TextDecoder().decode(await app.vault.adapter.readBinary(IGNORE_FILE))
  } catch (error) {
    console.debug('[abele-sync] cannot read the ignore file', error)
    throw new Error(`${IGNORE_FILE} is there but could not be read: ${messageOf(error)}`)
  }
}

/** What one sync did, in the line the log keeps — the same one the daemon writes. */
export function summarise(report: SyncReport): string {
  const pulled = report.pull.applied + (report.secondPull?.applied ?? 0)
  const held = (report.secondPull ?? report.pull).held.length
  return (
    `sync: done (pulled ${pulled}, pushed ${report.push.applied}, ` +
    `merged ${report.push.merged}, conflicts ${report.push.conflicts}, ` +
    `rejected ${report.push.rejected.length}, held ${held})`
  )
}
