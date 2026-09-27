import { EngineError } from '@abele/sync-core'

/** IndexedDB's callbacks as promises, and its failures as the engine's `io` errors. */

/**
 * One request as a promise.
 *
 * Awaiting it does not end the transaction: the continuation runs as a microtask of the
 * request's own success event, which is inside the window the specification keeps the
 * transaction active for. Awaiting anything else — a fetch, a hash — does end it, which is
 * the whole reason `transaction` is an overlay.
 */
export function wait<T>(request: IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error ?? new Error('the request failed'))
  })
}

/** Resolves when the transaction has committed, rejects when it aborted or errored. */
export function completion(tx: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(new EngineError('io', `${what}: the write was rolled back`, tx.error))
    tx.onerror = () => reject(new EngineError('io', what, tx.error))
  })
}

export const asEngineError = (what: string, cause: unknown): EngineError =>
  cause instanceof EngineError ? cause : new EngineError('io', what, cause)

/**
 * Whether IndexedDB failed because WebKit dropped the transaction under the request — never
 * because of anything in the request itself.
 *
 * On iOS the first request after the app comes back to the front fails with `UnknownError:
 * Attempt to get a record from database without an in-progress transaction` (or `… put …`),
 * and a WebView whose storage process was killed says `Connection to Indexed Database server
 * lost`. The same request made again, on a connection opened afresh, goes through; the state
 * store does exactly that, once. Looked for down the `cause` chain, since the store has usually
 * wrapped it in an `EngineError` by then.
 */
export function lostTransaction(error: unknown): boolean {
  for (let at = error, depth = 0; at !== undefined && at !== null && depth < 5; depth++) {
    if (typeof at !== 'object') return false
    const { name, message } = at as { name?: unknown; message?: unknown }
    if (
      name === 'UnknownError' &&
      typeof message === 'string' &&
      /without an in-progress transaction|Indexed Database server lost/i.test(message)
    ) {
      return true
    }
    at = (at as { cause?: unknown }).cause
  }
  return false
}

/**
 * One connection to the database `name`, made at the store's schema version: `build` makes the
 * stores of a database that is not there yet, and `onVersionChange` is handed the connection
 * when another window deletes or upgrades the database under it.
 */
export function connectTo(
  indexedDB: IDBFactory,
  name: string,
  build: (db: IDBDatabase) => void,
  onVersionChange: (db: IDBDatabase) => void,
  version = 1
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(name, version)
    } catch (cause) {
      reject(new EngineError('io', `cannot open the state database ${name}`, cause))
      return
    }
    request.onupgradeneeded = () => build(request.result)
    request.onblocked = () => {
      // Another connection holds the old version. It is asked to close by its own
      // `versionchange`; this only says why the open is taking so long.
      console.debug(`[abele-sync] the state database ${name} is held open elsewhere`)
    }
    request.onerror = () =>
      reject(new EngineError('io', `cannot open the state database ${name}`, request.error))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => onVersionChange(db)
      resolve(db)
    }
  })
}

/** Deletes the database `name`; see `IndexedDbStateStore.delete`. */
export function deleteDatabase(
  indexedDB: IDBFactory,
  name: string,
  blockedTimeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.deleteDatabase(name)
    } catch (cause) {
      reject(new EngineError('io', `cannot forget the state database ${name}`, cause))
      return
    }
    let timer: number | null = null
    const settle = (finish: () => void): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      finish()
    }
    request.onblocked = () => {
      console.debug(`[abele-sync] waiting to forget ${name}: it is still open somewhere`)
      // A connection that ignores `versionchange` — another window running an older build —
      // holds this open for ever otherwise.
      timer = window.setTimeout(() => {
        reject(new EngineError('io', `cannot forget ${name}: the state database is still open`))
      }, blockedTimeoutMs)
    }
    request.onerror = () =>
      settle(() =>
        reject(new EngineError('io', `cannot forget the state database ${name}`, request.error))
      )
    request.onsuccess = () => settle(resolve)
  })
}
