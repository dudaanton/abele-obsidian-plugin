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
  const timeout = (cause?: unknown) =>
    new Error(
      `Timed out after 20000ms waiting for native background state; last native app state=${previous ?? 'unobserved'}`,
      { cause }
    )
  for (;;) {
    const remaining = deadline - now()
    if (remaining <= 0) throw timeout()
    let raw: string
    try {
      // A native query may wait behind the Home transition in the runner.
      // Killing its client at five seconds discards otherwise valid replies.
      raw = run(['call', '/state', JSON.stringify({ bundle: 'md.obsidian' })], Math.ceil(remaining))
    } catch (error) {
      if ((error as { code?: string })?.code !== 'ETIMEDOUT') throw error
      if (now() >= deadline) throw timeout(error)
      await pause(Math.min(250, deadline - now()))
      continue
    }
    if (now() > deadline) throw timeout()
    const reply = JSON.parse(raw)
    const state = reply?.state
    if (!Number.isInteger(state) || state < 0 || state > 4)
      throw new Error('Invalid native app state reply; expected /state {state:0..4}')
    if (state !== previous) report(state)
    previous = state
    if (state === 2 || state === 3) return state
    if (state === 1) throw new Error('native app state is notRunning before the requested kill')
    if (now() >= deadline) throw timeout()
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
