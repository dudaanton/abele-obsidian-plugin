/**
 * The plugin's start, one named step at a time.
 *
 * `onload` is a long run of steps — settings, secrets, stores, views, editor extensions, the
 * layout-ready indexes — and a step that threw used to end it there: everything after it,
 * sidebar views included, was never registered, and the plugin looked half loaded. A step that
 * never finished did the same without a word. Each step now runs on its own:
 *
 * - a throw is logged with the step's name and the start goes on to the next step;
 * - every step logs how long it took and when it ended, counted from the start, at debug level;
 * - an awaited step still running after `SLOW_STEP_MS` says so as a warning, so a start that
 *   hangs names what it hangs on.
 */

export const SLOW_STEP_MS = 10_000

let startedAt = 0

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Resets the clock the steps are timed from; called first thing in `onload`. */
export function beginStartup(): void {
  startedAt = now()
}

function done(name: string, began: number): void {
  const end = now()
  console.debug(
    `[Abele] start: ${name} ${Math.round(end - began)} ms (at ${Math.round(end - startedAt)} ms)`
  )
}

function failed(name: string, error: unknown): void {
  console.error(`[Abele] start: ${name} failed, the rest of the start goes on`, error)
}

/** Runs a synchronous step; a throw is logged and swallowed. */
export function startupStep(name: string, fn: () => void): void {
  const began = now()
  try {
    fn()
  } catch (e) {
    failed(name, e)
    return
  }
  done(name, began)
}

/** Runs and awaits a step; a rejection is logged and swallowed, a slow one is reported. */
export async function startupStepAsync(name: string, fn: () => Promise<unknown>): Promise<void> {
  const began = now()
  const slow = window.setTimeout(() => {
    console.warn(`[Abele] start: ${name} is still running after ${SLOW_STEP_MS / 1000} s`)
  }, SLOW_STEP_MS)
  try {
    await fn()
  } catch (e) {
    failed(name, e)
    return
  } finally {
    window.clearTimeout(slow)
  }
  done(name, began)
}
