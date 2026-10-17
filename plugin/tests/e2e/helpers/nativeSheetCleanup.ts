export type NativeSheetDriver = (args: string[]) => string
const pauseFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Native previews block WebView evaluation, so cleanup uses only the system driver. */
export async function dismissNativeSheet(run: NativeSheetDriver, pause = pauseFor): Promise<void> {
  let empty = 0
  let requested = false
  let last: { alert?: unknown; text?: string[]; buttons?: string[] } | undefined
  for (let attempt = 0; attempt < 25; attempt++) {
    last = JSON.parse(run(['alert'])) as typeof last
    if (last?.alert === null) {
      // A preview can appear just after download completion; require a quiet interval.
      if (++empty === 3) return
      requested = false
    } else {
      empty = 0
      if (!requested) {
        const button = last?.buttons?.find((one) => /^(close|cancel|done)$/i.test(one))
        if (!button) throw new Error('Native sheet has no dismiss button: ' + JSON.stringify(last))
        run(['alert', button])
        requested = true
      }
    }
    await pause(200)
  }
  throw new Error('Native sheet remains after dismissal: ' + JSON.stringify(last))
}

export async function withNativeSheetCleanup<T>(
  work: () => Promise<T>,
  run: NativeSheetDriver,
  pause = pauseFor
): Promise<T> {
  const failures: unknown[] = []
  let value!: T
  try {
    value = await work()
  } catch (error) {
    failures.push(error)
  } finally {
    try {
      await dismissNativeSheet(run, pause)
    } catch (cleanup) {
      failures.push(cleanup)
    }
  }
  if (failures.length > 1)
    throw new AggregateError(failures, 'Attachment step and native sheet cleanup failed')
  if (failures.length) throw failures[0]
  return value
}
