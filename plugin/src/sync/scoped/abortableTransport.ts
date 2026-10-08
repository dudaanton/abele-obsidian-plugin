/** Release the caller even when a transport ignores AbortSignal. Late results never
 * reach the scoped reducer, but the same signal also cancels cooperative network I/O. */
export async function waitWithAbort<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error('Scoped request was cancelled')
  let cancel!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason ?? new Error('Scoped request was cancelled'))
    signal.addEventListener('abort', cancel, { once: true })
  })
  try {
    return await Promise.race([work(), aborted])
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

/** Preserve response identity/redirect checks and native method receivers. Cancellation
 * covers HTTP headers AND the body readers used by the scoped and sharing clients. */
export async function fetchWithAbort(
  fetcher: typeof fetch,
  signal: AbortSignal,
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await waitWithAbort(signal, () => fetcher(input, { ...init, signal }))
  const wrap = (target: Response): Response =>
    new Proxy(target, {
      get: (target, key) => {
        const value: unknown = Reflect.get(target, key, target)
        if (typeof value !== 'function') return value
        if (key === 'clone') return () => wrap(target.clone())
        if (['text', 'json', 'arrayBuffer', 'blob', 'formData'].includes(String(key)))
          return (...args: unknown[]) => waitWithAbort(signal, () => value.apply(target, args))
        return value.bind(target)
      },
    })
  return wrap(response)
}
