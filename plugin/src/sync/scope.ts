import type { App } from 'obsidian'
import {
  encodeText,
  IgnoreRules,
  settingsCategory,
  sha256,
  type PathMatcher,
  type SelectiveSettings,
} from '@abele/sync-core'
import { messageOf } from './messages'

/**
 * What this device syncs besides its selective settings: the vault's ignore file, the hidden
 * paths Obsidian cannot see, and the scope key both are hashed into. None of it holds state.
 */

/** The meta key the scope is filed under, the same one the daemon uses. */
export const SCOPE_KEY = 'scope'

/**
 * The scripts folder the engine assumes when it is given none — the core's own default, which it
 * does not export. Asked for only where the plugin reads a path the way the engine would.
 */
export const DEFAULT_SCRIPTS_FOLDER = 'Scripts'

/** The vault's ignore file, read from its root. */
export const IGNORE_FILE = '.abele-sync-ignore'

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

/**
 * What this device will not sync whatever the selective settings say: the vault's
 * `.abele-sync-ignore`, parsed by the core's own gitignore reader so that the plugin and the
 * daemon read one file the same way, and every hidden path but the config folder (`isHidden`).
 *
 * `keptOut` is one more wire path left alone, for as long as the engine this is built for runs:
 * this device's own `data.json` while it joins a vault (`EngineRunner.build`).
 */
export function ignoreFor(
  configDir: string,
  ignoreText: string | null,
  keptOut: string | null = null
): PathMatcher {
  const rules = ignoreText === null ? null : IgnoreRules.parse(ignoreText)
  return {
    ignores: (wirePath) =>
      wirePath === keptOut || isHidden(wirePath, configDir) || (rules?.ignores(wirePath) ?? false),
  }
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
