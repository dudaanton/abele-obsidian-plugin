import { driver } from './phone'

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
