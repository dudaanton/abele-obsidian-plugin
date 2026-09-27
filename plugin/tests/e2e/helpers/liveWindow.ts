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
  isObsidianRunning,
  notesInEditor,
  setBackgroundThrottling,
  setFocusEmulation,
  useDomMenus,
  waitForLinkIndex,
} from './obsidianCli'
import { onPhone } from './target'
import { installPhoneHost } from './phone'

const available = isObsidianRunning()

beforeAll(() => {
  if (!available) return
  // The page side of the phone harness: the file before may have reloaded it away.
  if (onPhone()) installPhoneHost()
  closeStrayWindows()
  notesInEditor()
  setBackgroundThrottling(false)
  setFocusEmulation(true)
  // Menus a test can open and pick from: see `useDomMenus`.
  useDomMenus()
  // The file before may have ended with an app reload; its link index is still filling in.
  waitForLinkIndex()
  // Nothing measured in a window that is not drawn means anything.
  assertWindowDrawn()
}, 150_000)

afterAll(() => {
  if (!available) return
  closeStrayWindows()
  notesInEditor()
})

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
