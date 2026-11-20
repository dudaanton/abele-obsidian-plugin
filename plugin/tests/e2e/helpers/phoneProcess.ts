import { driver } from './phone'

/** Query the native runner directly. Page eval wakes the app and cannot witness
 * backgrounding. Bound this below the held transfer's native request deadline. */
export async function waitForPhoneBackground(
  options: {
    run?: typeof driver
    now?: () => number
    pause?: (ms: number) => Promise<void>
    report?: (state: number) => void
  } = {}
): Promise<2 | 3> {
  const run = options.run ?? driver
  const now = options.now ?? Date.now
  const pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const report =
    options.report ?? ((state) => console.info('[phone native background state]', { state }))
  const deadline = now() + 20000
  let previous: number | undefined
  for (;;) {
    const reply = JSON.parse(
      run(
        ['call', '/state', JSON.stringify({ bundle: 'md.obsidian' })],
        Math.max(1, Math.min(5000, deadline - now()))
      )
    )
    const state = reply?.state
    if (!Number.isInteger(state) || state < 0 || state > 4)
      throw new Error('Invalid native app state reply; expected /state {state:0..4}')
    if (state !== previous) report(state)
    previous = state
    if (state === 2 || state === 3) return state
    if (state === 1) throw new Error('native app state is notRunning before the requested kill')
    if (now() >= deadline)
      throw new Error(
        `Timed out after 20000ms waiting for native background state; last native app state=${state}`
      )
    await pause(Math.min(250, deadline - now()))
  }
}

/** Check the client capability before invoking the device runner's terminate endpoint.
 * An old runner fails explicitly; a fresh launch is not evidence of process death. */
export function terminatePhone(run: typeof driver = driver): { killed: true; state: 1 } {
  if (!/\biphone kill\s+BUNDLE\b/.test(run(['--help'], 10000)))
    throw new Error('Phone driver kill capability is unavailable; update the driver')
  let result: { ok?: boolean; state?: number }
  try {
    result = JSON.parse(run(['kill', 'md.obsidian'], 30000))
  } catch (error) {
    throw new Error(
      'Phone device runner could not terminate the app; install the kill-capable device runner',
      { cause: error }
    )
  }
  if (result.ok !== true || result.state !== 1)
    throw new Error('Phone kill did not confirm notRunning')
  return { killed: true, state: 1 }
}
