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
import { beforeAll, afterAll } from 'vitest'
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

const available = isObsidianRunning()

beforeAll(() => {
  if (!available) return
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
