/**
 * Once for the whole tier: background throttling goes back on when the run is over, whatever
 * the files in between did. See `setBackgroundThrottling`.
 */
import { closeStrayWindows, isObsidianRunning, setBackgroundThrottling } from './obsidianCli'

export function setup(): void {}

export function teardown(): void {
  if (!isObsidianRunning()) return
  try {
    closeStrayWindows()
  } finally {
    setBackgroundThrottling(true)
  }
}
