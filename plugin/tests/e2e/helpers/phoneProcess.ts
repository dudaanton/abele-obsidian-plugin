import { driver } from './phone'

export interface PhoneBackgroundWitness {
  witness: 'springboard-home-icon'
  frame: number[]
}

/** /exists alone also matches text labels. Require a framed application icon in
 * SpringBoard's accessibility tree, without activating either application. */
function homeIcon(run: typeof driver, remaining: () => number): PhoneBackgroundWitness | null {
  const budget = () => {
    const value = remaining()
    if (value <= 0) throw Object.assign(new Error('Home witness deadline'), { code: 'ETIMEDOUT' })
    return Math.ceil(value)
  }
  const reply = JSON.parse(
    run(
      [
        'call',
        '/exists',
        JSON.stringify({
          bundle: 'com.apple.springboard',
          label: 'Obsidian',
          timeout: 0.25,
        }),
      ],
      budget()
    )
  )
  if (typeof reply?.exists !== 'boolean') throw new Error('Invalid native home icon reply')
  if (!reply.exists) return null
  const frame = reply.frame
  if (
    !Array.isArray(frame) ||
    frame.length !== 4 ||
    !frame.every(Number.isFinite) ||
    frame[2] <= 0 ||
    frame[3] <= 0
  )
    throw new Error('Invalid native home icon frame')
  const source = run(
    ['call', '/source', JSON.stringify({ bundle: 'com.apple.springboard' })],
    budget()
  )
  if (!/^\s*Icon\b[^\n]*\blabel: 'Obsidian'(?:,|\s*$)/m.test(source)) return null
  return { witness: 'springboard-home-icon', frame }
}

/** A negative control prevents an offscreen tree from certifying background. */
export function assertPhoneHomeScreenHidden(run: typeof driver = driver): void {
  const deadline = Date.now() + 20000
  if (homeIcon(run, () => deadline - Date.now()))
    throw new Error('Home icon is already exposed before Home; background witness is not usable')
}

/** Page eval wakes the app and app state can stay stale after Home. Observe the
 * SpringBoard icon directly, below the held transfer's native request deadline. */
export async function waitForPhoneBackground(
  options: {
    run?: typeof driver
    now?: () => number
    pause?: (ms: number) => Promise<void>
    report?: (visible: boolean) => void
  } = {}
): Promise<PhoneBackgroundWitness> {
  const run = options.run ?? driver
  const now = options.now ?? Date.now
  const pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const report =
    options.report ?? ((visible) => console.info('[phone background home icon]', { visible }))
  const deadline = now() + 20000
  let previous: boolean | undefined
  const timeout = (cause?: unknown) =>
    new Error(
      `Timed out after 20000ms waiting for native home icon; last home icon visible=${previous ?? 'unobserved'}`,
      { cause }
    )
  for (;;) {
    const remaining = deadline - now()
    if (remaining <= 0) throw timeout()
    let witness: PhoneBackgroundWitness | null
    try {
      witness = homeIcon(run, () => deadline - now())
    } catch (error) {
      if ((error as { code?: string })?.code !== 'ETIMEDOUT') throw error
      if (now() >= deadline) throw timeout(error)
      await pause(Math.min(250, deadline - now()))
      continue
    }
    if (now() > deadline) throw timeout()
    const visible = witness !== null
    if (visible !== previous) report(visible)
    previous = visible
    if (witness) return witness
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
