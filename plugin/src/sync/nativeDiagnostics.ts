const origins = new WeakMap<object, object>()
type NativeLayer = 'guarded' | 'syscall'
const pending = {
  guarded: new Map<string, Map<number, number>>(),
  syscall: new Map<string, Map<number, number>>(),
}
let nextCall = 0
const syscallPorts = new WeakMap<object, object>()

/** Counts our calls, not the host's entire libuv queue. Layers must never be summed:
 * a guarded call may be awaiting one of the separately measured syscall calls. */
export function nativeIoSnapshot() {
  const now = Date.now()
  const layer = (calls: Map<string, Map<number, number>>) => {
    let total = 0,
      long = 0
    const byKind: Record<string, { pending: number; longPending: number; oldestMs: number }> = {}
    for (const [kind, active] of calls) {
      let oldestMs = 0,
        longPending = 0
      for (const started of active.values()) {
        const elapsed = Math.max(0, now - started)
        oldestMs = Math.max(oldestMs, elapsed)
        if (elapsed >= 5000) longPending++
      }
      total += active.size
      long += longPending
      byKind[kind] = { pending: active.size, longPending, oldestMs }
    }
    return { pending: total, longPending: long, byKind }
  }
  return { guarded: layer(pending.guarded), syscall: layer(pending.syscall) }
}

/** Observe the Node promise API and its returned handles without patching shared modules. */
export function nativeSyscalls<T extends object>(host: T): T {
  const cached = syscallPorts.get(host)
  if (cached) return cached as T
  const wrapped = nativeDiagnostics(host, () => {}, 'syscall')
  syscallPorts.set(host, wrapped)
  syscallPorts.set(wrapped, wrapped)
  return wrapped
}

export function diagnosticOrigin<T extends object>(host: T): T {
  return (origins.get(host) ?? host) as T
}

/** Observe only this engine's native calls; never patch the host's shared filesystem. */
export function nativeDiagnostics<T extends object>(
  host: T,
  record: (
    operation: string,
    startedAt: number,
    outcome: string,
    paths?: readonly string[]
  ) => void,
  layer: NativeLayer = 'guarded'
): T {
  const wrap = <O extends object>(object: O, ownedPaths?: readonly string[]): O => {
    const proxy = new Proxy(object, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (typeof value !== 'function') return value
        return async (...args: unknown[]) => {
          const started = Date.now()
          const kind = String(key)
          const active = pending[layer].get(kind) ?? new Map<number, number>()
          pending[layer].set(kind, active)
          const id = ++nextCall
          active.set(id, started)
          let outcome = 'failed'
          try {
            const result = await value.apply(target, args)
            outcome = 'complete'
            return key === 'open' && result
              ? wrap(result, typeof args[0] === 'string' ? [args[0]] : undefined)
              : result
          } finally {
            active.delete(id)
            if (!active.size) pending[layer].delete(kind)
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
