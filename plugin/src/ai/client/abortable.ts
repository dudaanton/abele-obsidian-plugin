/** Stop waiting even when the underlying operation ignores cancellation. Late failures stay handled. */
export function abortable<T>(operation: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: number | undefined
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      if (timer !== undefined) window.clearTimeout(timer)
    }
    const abort = () => {
      signal?.removeEventListener('abort', abort)
      // Allow a result already completing in this tick to win. Never wait for the
      // operation itself: a non-cooperative tool or stream may never settle.
      timer = window.setTimeout(() => {
        reject(new DOMException('Stopped', 'AbortError'))
      }, 0)
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve(operation).then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}
