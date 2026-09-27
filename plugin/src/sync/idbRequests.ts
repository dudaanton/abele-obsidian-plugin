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
