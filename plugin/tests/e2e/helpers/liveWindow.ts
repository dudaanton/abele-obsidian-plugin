/**
 * Runs around every e2e file: the window is made to behave as if it were in front, and handed
 * back without a stray settings window. See `setBackgroundThrottling` and `closeStrayWindows`.
 *
 * Per file rather than once for the run: `emulateMobile` reloads the app, and a file that
 * crashes half way is exactly the one that leaves a settings window behind.
 */
import { beforeAll, afterAll } from 'vitest'
import {
  closeStrayWindows,
  isObsidianRunning,
  setBackgroundThrottling,
  waitForLinkIndex,
} from './obsidianCli'

const available = isObsidianRunning()

beforeAll(() => {
  if (!available) return
  closeStrayWindows()
  setBackgroundThrottling(false)
  // The file before may have ended with an app reload; its link index is still filling in.
  waitForLinkIndex()
}, 150_000)

afterAll(() => {
  if (!available) return
  closeStrayWindows()
})
