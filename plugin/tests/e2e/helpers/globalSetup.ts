/**
 * Once for the whole tier: background throttling goes back on when the run is over, whatever
 * the files in between did. See `setBackgroundThrottling`.
 *
 * A book's highlights note gives the vault's `file` property Obsidian's File type the first time
 * one is made (`src/properties/types.ts`), and that lands in the fixture vault's `types.json`.
 * It is taken out again at the end when the vault did not have it before the run.
 */
import {
  closeStrayWindows,
  evalJson,
  evalRaw,
  isObsidianRunning,
  setBackgroundThrottling,
} from './obsidianCli'

let fileTypeBefore: string | null | undefined

export function setup(): void {
  if (!isObsidianRunning()) return
  try {
    fileTypeBefore = evalJson<string | null>(
      `app.metadataTypeManager?.getAssignedWidget?.('file') ?? null`,
      30_000
    )
  } catch {
    fileTypeBefore = undefined
  }
}

export function teardown(): void {
  if (!isObsidianRunning()) return
  try {
    closeStrayWindows()
    if (fileTypeBefore === null)
      evalRaw(
        `(async () => { await app.metadataTypeManager?.unsetType?.('file'); return 'ok' })()`,
        30_000
      )
  } finally {
    setBackgroundThrottling(true)
  }
}
