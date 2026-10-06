/**
 * Runs around every e2e file: the window is made to behave as if it were in front and focused, with its
 * menus drawn in the page — and the file refused if it is not drawn at all, the screen locked — and
 * handed back without a stray settings window, and with every note tab in the editor rather than in
 * reading view, so no file depends on the mode the one before left a tab in. See
 * `setBackgroundThrottling`, `useDomMenus`, `closeStrayWindows` and `notesInEditor`.
 *
 * Per file rather than once for the run: `emulateMobile` reloads the app, and a file that
 * crashes half way is exactly the one that leaves a settings window behind.
 */
import { beforeAll, afterAll, beforeEach, onTestFailed } from 'vitest'
import {
  assertWindowDrawn,
  closeStrayWindows,
  evalLong,
  isObsidianRunning,
  notesInEditor,
  setBackgroundThrottling,
  setFocusEmulation,
  useDomMenus,
  waitForLinkIndex,
} from './obsidianCli'
import { onPhone } from './target'
import { installPhoneHost } from './phone'
import { RESTORE_PHONE_SCRIPT } from './phoneState'
import { assertNoLeakedRootViews, snapshotRootViews, type RootView } from './rootViews'

let rootViews: RootView[] | undefined

const cleanPhone = async () => {
  if (!onPhone()) return
  const raw = await evalLong(RESTORE_PHONE_SCRIPT, 30_000)
  if (raw.startsWith('Error:')) throw new Error(raw)
  console.info('Phone boundary:', JSON.parse(raw))
}

const available = isObsidianRunning()

beforeAll(async () => {
  if (!available) return
  // The page side of the phone harness: the file before may have reloaded it away.
  if (onPhone()) installPhoneHost()
  // Each helper owns its bounded idempotent retry. An outer retry would multiply attempts
  // and could block the worker past its reporting ceiling after a helper exhausted its budget.
  closeStrayWindows()
  notesInEditor()
  await cleanPhone()
  setBackgroundThrottling(false)
  setFocusEmulation(true)
  // Menus a test can open and pick from: see `useDomMenus`.
  useDomMenus()
  // The file before may have ended with an app reload; its link index is still filling in.
  waitForLinkIndex()
  // Nothing measured in a window that is not drawn means anything.
  assertWindowDrawn()
  rootViews = snapshotRootViews()
}, 150_000)

// Stack hook ordering keeps this boundary outside every file's fixture teardown.
// Finally restores state even when idempotent window cleanup itself fails.
afterAll(async () => {
  if (!available) return
  try {
    closeStrayWindows()
    notesInEditor()
  } finally {
    try {
      if (rootViews) assertNoLeakedRootViews(rootViews)
    } finally {
      await cleanPhone()
    }
  }
}, 90_000)

/**
 * A test that failed only because it asked for something a phone does not have (see
 * `DesktopOnlyError`) is reported as skipped, with what it needed, rather than as failed.
 */
beforeEach(() => {
  onTestFailed(({ task }) => {
    const errors = task.result?.errors ?? []
    if (!errors.length || !errors.every((e) => e?.name === 'DesktopOnlyError')) return
    // The runner reports a result in this state as skipped, `note` as the reason.
    const result = task.result as NonNullable<typeof task.result> & { note?: string }
    result.state = 'skip'
    result.note = errors[0].message
    result.errors = undefined
  })
})
