/** The browser and host use the same inactivity budget; elapsed time is never progress. */
export async function waitForStartup(
  read: () =>
    | { ready: boolean; progress: string; error?: string }
    | Promise<{ ready: boolean; progress: string; error?: string }>,
  stallMs = 30000,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 100)),
  now: () => number = () => Date.now(),
  limitMs = Infinity
): Promise<void> {
  let previous = ''
  let advanced = now()
  const started = advanced
  for (;;) {
    const state = await read()
    if (state.error) throw new Error(state.error)
    if (state.ready) return
    if (now() - started >= limitMs)
      throw new Error('Sync startup deadline exceeded: ' + state.progress)
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

/** A confidential connect may expose this fixed reason, never the evaluator's private detail. */
export function startupWaitFailure(error: unknown): string | undefined {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  for (const reason of ['Sync startup progress stalled', 'Sync startup deadline exceeded'])
    if (message === reason || message.startsWith(reason + ':')) return reason
  return undefined
}
