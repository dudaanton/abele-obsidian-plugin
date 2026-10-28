/** Bound one invocation without changing another caller of a shared project model. */
export function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error('Requests tool stopped'))
    if (signal.aborted) stop()
    else signal.addEventListener('abort', stop, { once: true })
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop))
  })
}

export function requestLifetime(parent?: AbortSignal, sending = false) {
  const controller = new AbortController()
  const outcome = sending
    ? ' A send may have reached the service; check http_send_result before sending again.'
    : ''
  const stop = () => controller.abort(new Error(`Requests tool stopped.${outcome}`))
  parent?.addEventListener('abort', stop, { once: true })
  if (parent?.aborted) stop()
  let timer: number
  const deadline = (ms: number) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(
      () => controller.abort(new Error(`Requests tool timed out.${outcome}`)),
      ms
    )
  }
  deadline(30000)
  return {
    signal: controller.signal,
    deadline,
    dispose() {
      window.clearTimeout(timer)
      parent?.removeEventListener('abort', stop)
    },
  }
}
