const origins = new WeakMap<object, object>()

export function diagnosticOrigin<T extends object>(host: T): T {
  return (origins.get(host) ?? host) as T
}

/** Observe only this engine's native calls; never patch the host's shared filesystem. */
export function nativeDiagnostics<T extends object>(
  host: T,
  record: (operation: string, startedAt: number, outcome: string, paths?: readonly string[]) => void
): T {
  const wrap = <O extends object>(object: O, ownedPaths?: readonly string[]): O => {
    const proxy = new Proxy(object, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (typeof value !== 'function') return value
        return async (...args: unknown[]) => {
          const started = Date.now()
          let outcome = 'failed'
          try {
            const result = await value.apply(target, args)
            outcome = 'complete'
            return key === 'open' && result
              ? wrap(result, typeof args[0] === 'string' ? [args[0]] : undefined)
              : result
          } finally {
            record(
              'native ' +
                String(key) +
                (key === 'open' && typeof args[1] === 'string' ? ' ' + args[1] : ''),
              started,
              outcome,
              ownedPaths ??
                args
                  .slice(0, key === 'rename' || key === 'link' ? 2 : 1)
                  .filter((value): value is string => typeof value === 'string')
            )
          }
        }
      },
    })
    origins.set(proxy, diagnosticOrigin(object))
    return proxy
  }
  return wrap(host)
}
