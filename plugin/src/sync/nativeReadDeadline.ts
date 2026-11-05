import { EngineError } from '@abele/sync-sdk/core'

export const NATIVE_READ_DEADLINE_MS = 15000
export class NativeReadTimeout extends EngineError {
  readonly retryable = true
  constructor(operation: string, uncertain = false) {
    super('offline', 'The filesystem did not answer. Sync will retry.', {
      code: uncertain ? 'native-operation-timeout' : 'native-read-timeout',
      operation,
      ...(uncertain ? { uncertain: true } : {}),
    })
  }
}

/** Read-only waits may be abandoned. Writes must keep their existing durable ownership. */
export function boundedNativeRead<T>(
  work: Promise<T>,
  operation: string,
  late?: (value: T) => Promise<void>,
  expiredOperation?: (error: NativeReadTimeout) => void,
  uncertain = false
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false
    const timer = window.setTimeout(() => {
      expired = true
      const error = new NativeReadTimeout(operation, uncertain)
      expiredOperation?.(error)
      reject(error)
    }, NATIVE_READ_DEADLINE_MS)
    void work.then(
      (value) => {
        window.clearTimeout(timer)
        if (expired) {
          // No continuation may use a handle acquired after its consumer has left.
          if (late) {
            try {
              void late(value).catch((error) =>
                console.debug('[abele-sync] late native read cleanup failed', error)
              )
            } catch (error) {
              console.debug('[abele-sync] late native read cleanup failed', error)
            }
          }
        } else resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        if (!expired)
          reject(error instanceof Error ? error : new Error('Native read failed', { cause: error }))
      }
    )
  })
}

const operationPorts = new WeakMap<object, Map<string, object>>()
const fallbackScopes = new Map<string, Set<NativeReadTimeout>>()
function uncertainRegistry(): Map<string, Set<NativeReadTimeout>> {
  if (typeof window === 'undefined') return fallbackScopes
  const key = Symbol.for('abele.sync.native-uncertain-operations-v1')
  let registry = Reflect.get(window, key)
  if (!(registry instanceof Map)) {
    registry = new Map<string, Set<NativeReadTimeout>>()
    Reflect.set(window, key, registry)
  }
  return registry
}
const readMethods = new Set([
  'lstat',
  'stat',
  'realpath',
  'readdir',
  'read',
  'readFile',
  'readlink',
  'access',
])

/** A timeout ends the caller's wait, never pretends an issued mutation was cancelled.
 * Every port for this vault fences new work until uncertain native effects really settle. */
export function boundedNativeOperations<T extends object>(port: T, scope: string): T {
  // A plugin reload cannot cancel an issued native mutation. Keep its fence in the page.
  const uncertainScopes = uncertainRegistry()
  let scopes = operationPorts.get(port)
  if (!scopes) operationPorts.set(port, (scopes = new Map()))
  const cached = scopes.get(scope)
  if (cached) return cached as T
  const wrap = (target: object): object =>
    new Proxy(target, {
      get(host, key) {
        const value = Reflect.get(host, key)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          const kind = String(key)
          const blocked = uncertainScopes.get(scope)?.values().next().value
          if (blocked && kind !== 'close')
            return Promise.reject(
              new NativeReadTimeout(
                String(
                  (blocked.cause as { operation?: string } | undefined)?.operation ??
                    'pending native effect'
                ),
                true
              )
            )
          let failure: NativeReadTimeout | undefined
          const mutation =
            !readMethods.has(kind) && kind !== 'close' && !(kind === 'open' && args[1] === 'r')
          const work = Promise.resolve(value.apply(host, args))
          const settled = () => {
            if (!failure) return
            const held = uncertainScopes.get(scope)
            held?.delete(failure)
            if (held?.size === 0) uncertainScopes.delete(scope)
          }
          void work.then(settled, settled)
          return boundedNativeRead(
            work,
            kind,
            key === 'open'
              ? async (handle) => {
                  if (handle && typeof Reflect.get(handle, 'close') === 'function')
                    await boundedNativeRead(Reflect.get(handle, 'close').call(handle), 'close')
                }
              : undefined,
            mutation
              ? (error) => {
                  failure = error
                  let held = uncertainScopes.get(scope)
                  if (!held) uncertainScopes.set(scope, (held = new Set()))
                  held.add(error)
                }
              : undefined,
            mutation
          ).then((result) => (key === 'open' && result ? wrap(result) : result))
        }
      },
    })
  const wrapped = wrap(port) as T
  scopes.set(scope, wrapped)
  operationPorts.set(wrapped, new Map([[scope, wrapped]]))
  return wrapped
}

const ports = new WeakMap<object, object>()
export function boundedNativeMetadata<T extends object>(port: T): T {
  const cached = ports.get(port)
  if (cached) return cached as T
  const wrapped = new Proxy(port, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      return ['lstat', 'stat', 'realpath'].includes(String(key))
        ? (...args: unknown[]) => boundedNativeRead(value.apply(target, args), String(key))
        : value.bind(target)
    },
  })
  ports.set(port, wrapped)
  ports.set(wrapped, wrapped)
  return wrapped
}

/** Only handles opened without write/create/truncate flags may use this port. */
export function boundedNativeReader<T extends object>(handle: T): T {
  return new Proxy(handle, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      return ['read', 'readFile', 'stat', 'close'].includes(String(key))
        ? (...args: unknown[]) => boundedNativeRead(value.apply(target, args), String(key))
        : value.bind(target)
    },
  })
}
