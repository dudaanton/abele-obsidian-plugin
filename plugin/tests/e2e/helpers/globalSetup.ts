/**
 * Once for the whole tier: background throttling and focus emulation go back to normal when the
 * run is over, whatever the files in between did. See `setBackgroundThrottling`. The window is
 * put back to a desktop at its own size before the run and after it, whatever an earlier run
 * killed half way left it as (`restoreDesktopWindow`).
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
  hasTestApi,
  restoreDesktopWindow,
  setBackgroundThrottling,
  setFocusEmulation,
} from './obsidianCli'
import { onPhone } from './target'
import {
  assertPhoneReady,
  dropPhone,
  installBuild,
  startHost,
  stopHost,
  takePhone,
} from './phoneHost'
import { driver } from './phone'

const KEYS = ['file', 'files']
let typesBefore: Record<string, string | null> | undefined

export async function setup(): Promise<void> {
  if (onPhone()) {
    // The phone is taken for the whole run, checked, given this tree's build and the page
    // side of the harness; see phoneHost.ts. Any failure stops the run with its reason.
    takePhone('abele-e2e')
    try {
      assertPhoneReady()
      // Obsidian brought forward and made the app the driver's touches and typing go to: a driver
      // started again since it last was is aimed at the home screen, and text typed there is
      // typed into nothing — which ends the driver (2026-09-27).
      driver(['launch', 'md.obsidian'])
      const version = installBuild(process.cwd())
      await startHost()
      console.info(`\n  phone ready, abele ${version}\n`)
    } catch (error) {
      stopHost()
      dropPhone()
      throw error
    }
  }
  const running = isObsidianRunning()
  if (!running || !hasTestApi()) {
    if (onPhone()) {
      stopHost()
      dropPhone()
    }
    throw new Error(!running
      ? 'Obsidian is not running; an explicit e2e run requires the app.'
      : 'The e2e vault needs a development build with the test API.')
  }
  await restoreDesktopWindow()
  try {
    typesBefore = evalJson<Record<string, string | null>>(
      `Object.fromEntries(${JSON.stringify(KEYS)}.map((k) => [k, app.metadataTypeManager?.getAssignedWidget?.(k) ?? null]))`,
      30_000
    )
  } catch {
    typesBefore = undefined
  }
}

export async function teardown(): Promise<void> {
  try {
    await putAppBack()
  } finally {
    // Last: on a phone every call above goes to the phone, and one made after the drop would
    // take it again under this run's name, a lock nobody would give back.
    if (onPhone()) {
      stopHost()
      dropPhone()
    }
  }
}

async function putAppBack(): Promise<void> {
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
    try {
      await restoreDesktopWindow()
    } catch (error) {
      console.warn('the window could not be put back to a desktop:', error)
    }
    setBackgroundThrottling(true)
    setFocusEmulation(false)
  }
}
