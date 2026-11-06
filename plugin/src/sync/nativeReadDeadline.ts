import { EngineError } from '@abele/sync-sdk/core'
import { Notice } from 'obsidian'
import { t } from '@/i18n'

export const NATIVE_READ_DEADLINE_MS = 15000
function nativeDeadline(expire: () => void, deadlineMs = NATIVE_READ_DEADLINE_MS): () => void {
  if (typeof window !== 'undefined') {
    const host = window
    const timer = host.setTimeout(expire, deadlineMs)
    return () => host.clearTimeout(timer)
  }
  // Portable adapters also run in clients without a DOM. Keep their read bounds
  // without turning a missing window into an apparent content mismatch.
  const start = setTimeout.bind(undefined)
  const cancel = clearTimeout.bind(undefined)
  const timer = start(expire, deadlineMs)
  return () => cancel(timer)
}
export class NativeReadTimeout extends EngineError {
  readonly retryable = true
  constructor(operation: string, uncertain = false) {
    super(
      'offline',
      uncertain
        ? t('sync.nativeMutationRestart')
        : 'The filesystem did not answer. Sync will retry.',
      {
        code: uncertain ? 'native-operation-timeout' : 'native-read-timeout',
        operation,
        ...(uncertain ? { uncertain: true } : {}),
      }
    )
  }
}

/** Read-only waits may be abandoned. Writes must keep their existing durable ownership. */
export function boundedNativeRead<T>(
  work: Promise<T>,
  operation: string,
  late?: (value: T) => Promise<void>,
  expiredOperation?: (error: NativeReadTimeout) => void,
  uncertain = false,
  deadlineMs = NATIVE_READ_DEADLINE_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false
    const cancelTimer = nativeDeadline(() => {
      expired = true
      const error = new NativeReadTimeout(operation, uncertain)
      expiredOperation?.(error)
      reject(error)
    }, deadlineMs)
    void work.then(
      (value) => {
        cancelTimer()
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
        cancelTimer()
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

function readOnlyOpen(flags: unknown): boolean {
  if (typeof flags === 'string') return ['r', 'rs', 'sr'].includes(flags)
  if (typeof flags !== 'number' || !Number.isSafeInteger(flags)) return false
  // Flag values differ by platform. Use the same native constants as no-follow open.
  const require = typeof window === 'undefined' ? undefined : Reflect.get(window, 'require')
  if (typeof require !== 'function') return false
  const constants = require('original-fs').constants
  const keys = ['O_WRONLY', 'O_RDWR', 'O_CREAT', 'O_TRUNC', 'O_APPEND']
  if (!keys.every((key) => Number.isSafeInteger(constants?.[key]))) return false
  return (flags & keys.reduce((mask, key) => mask | constants[key], 0)) === 0
}

/** Read deadlines release safe waits. Mutation deadlines only fence new sync work:
 * their callers must retain host queues and path leases until the native call settles. */
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
            !readMethods.has(kind) &&
            kind !== 'close' &&
            !(kind === 'open' && readOnlyOpen(args[1]))
          const work = Promise.resolve(value.apply(host, args))
          if (mutation) {
            const cancelTimer = nativeDeadline(() => {
              failure = new NativeReadTimeout(kind, true)
              let held = uncertainScopes.get(scope)
              const first = !held?.size
              if (!held) uncertainScopes.set(scope, (held = new Set()))
              held.add(failure)
              if (first) {
                try {
                  new Notice(t('sync.nativeMutationStuckNotice'), 0)
                } catch (error) {
                  console.error(
                    '[abele-sync] could not show the stuck file operation notice',
                    error
                  )
                }
              }
            })
            const finish = () => {
              cancelTimer()
              settled()
            }
            // Never race this promise against a deadline: rejection would release
            // serialization while the kernel may still change the file later.
            return work.then(
              (result) => {
                finish()
                return key === 'open' && result ? wrap(result) : result
              },
              (error) => {
                finish()
                throw error
              }
            )
          }
          function settled() {
            if (!failure) return
            const held = uncertainScopes.get(scope)
            held?.delete(failure)
            if (held?.size === 0) uncertainScopes.delete(scope)
          }
          return boundedNativeRead(
            work,
            kind,
            key === 'open'
              ? async (handle) => {
                  if (handle && typeof Reflect.get(handle, 'close') === 'function')
                    await boundedNativeRead(Reflect.get(handle, 'close').call(handle), 'close')
                }
              : undefined
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
