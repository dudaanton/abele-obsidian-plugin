/** Stop waiting for input without letting a late answer resume the cancelled operation. */
export function waitForScript<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Script stopped'))
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        signal.reason instanceof Error && signal.reason.name !== 'AbortError'
          ? signal.reason
          : new Error('Script stopped')
      )
    signal.addEventListener('abort', abort, { once: true })
    const finish = () => signal.removeEventListener('abort', abort)
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted()
        return work()
      })
      .then(
        (value) => {
          finish()
          resolve(value)
        },
        (error: unknown) => {
          finish()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      )
  })
}
