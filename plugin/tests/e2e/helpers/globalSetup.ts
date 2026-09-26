/**
 * Once for the whole tier: background throttling and focus emulation go back to normal when the
 * run is over, whatever the files in between did. See `setBackgroundThrottling`.
 *
 * The plugin gives the vault's `file` and `files` properties the File and Files types
 * (`src/properties/types.ts`) while it draws properties, and that lands in the fixture vault's
 * `types.json`. Whichever the vault did not have before the run is taken out again at the end.
 */
import {
  closeStrayWindows,
  evalJson,
  evalRaw,
  isObsidianRunning,
  setBackgroundThrottling,
  setFocusEmulation,
} from './obsidianCli'

const KEYS = ['file', 'files']
let typesBefore: Record<string, string | null> | undefined

export function setup(): void {
  if (!isObsidianRunning()) return
  try {
    typesBefore = evalJson<Record<string, string | null>>(
      `Object.fromEntries(${JSON.stringify(KEYS)}.map((k) => [k, app.metadataTypeManager?.getAssignedWidget?.(k) ?? null]))`,
      30_000
    )
  } catch {
    typesBefore = undefined
  }
}

export function teardown(): void {
  if (!isObsidianRunning()) return
  try {
    closeStrayWindows()
    const added = KEYS.filter((k) => typesBefore && typesBefore[k] === null)
    if (added.length)
      evalRaw(
        `(async () => { for (const k of ${JSON.stringify(added)}) await app.metadataTypeManager?.unsetType?.(k); return 'ok' })()`,
        30_000
      )
  } finally {
    setBackgroundThrottling(true)
    setFocusEmulation(false)
  }
}
