/** Bound native structured-clone work as well as the JavaScript visitor. Queue each
 * page from its success event to retain one readonly transaction's snapshot. An
 * awaited host yield here would let that transaction commit between pages. */
export function readIdbSnapshot<T>(
  store: IDBObjectStore,
  keyOf: (row: T) => IDBValidKey,
  range?: IDBKeyRange
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const rows: T[] = []
    if (typeof IDBKeyRange === 'undefined') {
      const request = store.openCursor(range)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return resolve(rows)
        rows.push(cursor.value as T)
        cursor.continue()
      }
      return
    }
    const page = (bounds?: IDBKeyRange) => {
      const request = store.getAll(bounds, 32)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        try {
          const found = request.result as T[]
          rows.push(...found)
          if (found.length < 32) return resolve(rows)
          const last = keyOf(found[found.length - 1])
          // The last row can equal a closed upper bound. No valid empty range
          // can be constructed with an exclusive lower bound in that case.
          if (
            range?.upper !== undefined &&
            !range.upperOpen &&
            !IDBKeyRange.upperBound(range.upper, true).includes(last)
          )
            return resolve(rows)
          page(
            range?.upper === undefined
              ? IDBKeyRange.lowerBound(last, true)
              : IDBKeyRange.bound(last, range.upper, true, range.upperOpen)
          )
        } catch (error) {
          reject(asEngineError('cannot read database snapshot', error))
        }
      }
    }
    page(range)
  })
}
import { asEngineError } from './idbRequests'
