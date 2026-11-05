import { EngineError } from '@abele/sync-sdk/core'

export const NATIVE_READ_DEADLINE_MS = 15000
export class NativeReadTimeout extends EngineError {
  readonly retryable = true
  constructor(operation: string) {
    super('offline', 'The filesystem did not answer. Sync will retry.', {
      code: 'native-read-timeout',
      operation,
    })
  }
}

/** Read-only waits may be abandoned. Writes must keep their existing durable ownership. */
export function boundedNativeRead<T>(
  work: Promise<T>,
  operation: string,
  late?: (value: T) => Promise<void>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false
    const timer = window.setTimeout(() => {
      expired = true
      reject(new NativeReadTimeout(operation))
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
