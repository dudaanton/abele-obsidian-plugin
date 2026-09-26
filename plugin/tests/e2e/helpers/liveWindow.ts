/**
 * Runs around every e2e file: the window is made to behave as if it were in front and focused — and the file
 * refused if it is not drawn at all, the screen locked — and handed back without a stray settings
 * window. See `setBackgroundThrottling` and `closeStrayWindows`.
 *
 * Per file rather than once for the run: `emulateMobile` reloads the app, and a file that
 * crashes half way is exactly the one that leaves a settings window behind.
 */
import { beforeAll, afterAll } from 'vitest'
import {
  assertWindowDrawn,
  closeStrayWindows,
  isObsidianRunning,
  setBackgroundThrottling,
  setFocusEmulation,
  waitForLinkIndex,
} from './obsidianCli'

const available = isObsidianRunning()

beforeAll(() => {
  if (!available) return
  closeStrayWindows()
  setBackgroundThrottling(false)
  setFocusEmulation(true)
  // The file before may have ended with an app reload; its link index is still filling in.
  waitForLinkIndex()
  // Nothing measured in a window that is not drawn means anything.
  assertWindowDrawn()
}, 150_000)

afterAll(() => {
  if (!available) return
  closeStrayWindows()
})
