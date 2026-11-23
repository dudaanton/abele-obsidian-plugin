/** Independent limits: unused time in one phase never extends another phase. */
// Calibration: creation 72 s, upload resume 160 s, phone byte audit 5.1 s,
// desktop pull about 300 s after bounded metadata reads, server audit 17 s.
// Interruption limits include the foreground/background/kill/relaunch controls;
// the generous desktop margin cannot relax any phone or byte-verification limit.
export const phoneGateBudgets = {
  connect: 30_000,
  'create phone files': 180_000,
  'upload interruption': 360_000,
  'prepare remote files': 60_000,
  'pull interruption': 120_000,
  'verify phone bytes': 30_000,
  'desktop replica': 900_000,
  'verify server bytes': 60_000,
} as const

// Only a last-resort watchdog for broken cancellation/cleanup. Phase limits below
// decide success; this aggregate cannot donate unused time to an expired phase.
export const phoneGateWatchdog =
  Object.values(phoneGateBudgets).reduce((sum, budget) => sum + budget, 0) + 120_000

/** Work must pass the signal to cancellable I/O. Await its finally blocks on expiry,
 * so the next case cannot inherit a still-running desktop replica or verification. */
export async function runGatePhase<T>(
  phase: string,
  budgetMs: number,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const started = Date.now()
  const controller = new AbortController()
  const expired = new Error(`${phase} exceeded ${budgetMs} ms`)
  const timer = setTimeout(() => controller.abort(expired), budgetMs)
  console.info('[phone gate phase]', { phase, budgetMs, state: 'started' })
  try {
    const result = await work(controller.signal)
    if (Date.now() - started >= budgetMs) controller.abort(expired)
    controller.signal.throwIfAborted()
    return result
  } catch (cause) {
    if (controller.signal.aborted) throw new Error(expired.message, { cause })
    throw cause
  } finally {
    clearTimeout(timer)
    console.info('[phone gate phase]', {
      phase,
      budgetMs,
      elapsedMs: Date.now() - started,
      expired: controller.signal.aborted,
    })
  }
}
