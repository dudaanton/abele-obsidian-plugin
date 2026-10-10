/** The browser and host use the same inactivity budget; elapsed time is never progress. */
export async function waitForStartup(
  read: () =>
    | { ready: boolean; progress: string; error?: string }
    | Promise<{ ready: boolean; progress: string; error?: string }>,
  stallMs = 30000,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 100)),
  now: () => number = () => Date.now()
): Promise<void> {
  let previous = ''
  let advanced = now()
  for (;;) {
    const state = await read()
    if (state.error) throw new Error(state.error)
    if (state.ready) return
    if (state.progress !== previous) {
      previous = state.progress
      advanced = now()
    }
    if (now() - advanced >= stallMs)
      throw new Error('Sync startup progress stalled: ' + state.progress)
    await pause()
  }
}
export const STARTUP_WAIT = `const waitForStartup = ${waitForStartup.toString()};`
