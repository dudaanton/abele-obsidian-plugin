const origins = new WeakMap<object, object>()
type NativeLayer = 'guarded' | 'syscall'
const pending = {
  guarded: new Map<string, Map<number, number>>(),
  syscall: new Map<string, Map<number, number>>(),
}
let nextCall = 0
const syscallPorts = new WeakMap<object, Map<string, object>>()
const measuredPorts = new WeakSet<object>()
export type NativeLstatSource = 'host-fs.promises' | 'host-original-fs.promises' | 'adapter'
type LstatRecord = {
  id: number
  path: string | null
  source: NativeLstatSource
  site: string
  startedAt: number
  returnedAt: number | null
  settledAt: number | null
  outcome: 'pending' | 'fulfilled' | 'rejected' | 'threw'
}
const lstats = new Map<number, LstatRecord>()
const recentLstats: LstatRecord[] = []
const slowLstats: LstatRecord[] = []

/** Bounded evidence at the promise API boundary; no file bytes or extra I/O. */
export function nativeLstatSnapshot() {
  return {
    pendingCount: lstats.size,
    pending: [...lstats.values()].slice(0, 16).map((row) => ({ ...row })),
    recent: recentLstats.map((row) => ({ ...row })),
    slow: slowLstats.map((row) => ({ ...row })),
  }
}

/** Counts our calls, not the host's entire libuv queue. Layers must never be summed:
 * a guarded call may be awaiting one of the separately measured syscall calls. */
export function nativeIoSnapshot() {
  const now = Date.now()
  const layer = (calls: Map<string, Map<number, number>>) => {
    let total = 0,
      long = 0
    const byKind: Record<string, { pending: number; longPending: number; oldestMs: number }> = {}
    for (const [kind, active] of calls) {
      if (!active.size) continue
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
export function nativeSyscalls<T extends object>(
  host: T,
  site = 'unspecified',
  identify?: (host: object) => NativeLstatSource
): T {
  if (measuredPorts.has(host)) return host
  let ports = syscallPorts.get(host)
  if (!ports) syscallPorts.set(host, (ports = new Map()))
  const cached = ports.get(site)
  if (cached) return cached as T
  // The guarded filesystem boundary owns module access. Diagnostics receives
  // its identity classifier and invokes it only when a port is first observed.
  const source = identify?.(host) ?? 'adapter'
  const wrapped = nativeDiagnostics(host, undefined, 'syscall', { source, site })
  ports.set(site, wrapped)
  measuredPorts.add(wrapped)
  return wrapped
}

export function diagnosticOrigin<T extends object>(host: T): T {
  return (origins.get(host) ?? host) as T
}

/** Observe only this engine's native calls; never patch the host's shared filesystem. */
export function nativeDiagnostics<T extends object>(
  host: T,
  record:
    | ((operation: string, startedAt: number, outcome: string, paths?: readonly string[]) => void)
    | undefined,
  layer: NativeLayer = 'guarded',
  boundary?: Pick<LstatRecord, 'source' | 'site'>
): T {
  const wrap = <O extends object>(object: O, ownedPaths?: readonly string[]): O => {
    // Cache callable scaffolding, never an I/O result. Hosts may replace methods.
    const methods = new Map<
      PropertyKey,
      { source: unknown; call: (...args: unknown[]) => Promise<unknown> }
    >()
    const proxy = new Proxy(object, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (typeof value !== 'function') return value
        const previous = methods.get(key)
        if (previous?.source === value) return previous.call
        const call = async (...args: unknown[]) => {
          const started = Date.now()
          const kind = String(key)
          const active = pending[layer].get(kind) ?? new Map<number, number>()
          pending[layer].set(kind, active)
          const id = ++nextCall
          active.set(id, started)
          const trace: LstatRecord | undefined =
            key === 'lstat' && boundary
              ? {
                  id,
                  path: typeof args[0] === 'string' ? args[0] : null,
                  ...boundary,
                  startedAt: started,
                  returnedAt: null,
                  settledAt: null,
                  outcome: 'pending',
                }
              : undefined
          if (trace) lstats.set(id, trace)
          let outcome = 'failed'
          try {
            // No await, queue, lock or cancellation between entry and invoking the host.
            const request = value.apply(target, args)
            if (trace) trace.returnedAt = Date.now()
            const result = await request
            if (trace) trace.outcome = 'fulfilled'
            outcome = 'complete'
            return key === 'open' && result
              ? wrap(result, typeof args[0] === 'string' ? [args[0]] : undefined)
              : result
          } finally {
            if (trace) {
              trace.settledAt = Date.now()
              if (trace.outcome === 'pending')
                trace.outcome = trace.returnedAt === null ? 'threw' : 'rejected'
              lstats.delete(id)
              recentLstats.push(trace)
              if (recentLstats.length > 16) recentLstats.shift()
              // Preserve late completion even after subsequent fast polls replace recent rows.
              if (trace.settledAt - trace.startedAt >= 5000) {
                slowLstats.push(trace)
                if (slowLstats.length > 8) slowLstats.shift()
              }
            }
            active.delete(id)
            // Keep the empty per-method container, not completed calls. Allocating
            // another Map for every sequential syscall creates avoidable GC work.
            record?.(
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
        methods.set(key, { source: value, call })
        return call
      },
    })
    origins.set(proxy, diagnosticOrigin(object))
    return proxy
  }
  return wrap(host)
}
