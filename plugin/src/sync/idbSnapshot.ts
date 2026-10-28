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
    let loaded = 0
    const page = (bounds?: IDBKeyRange) => {
      // Small snapshots keep tiny native result objects. A sustained inventory
      // amortizes request callbacks without ever cloning the whole store at once.
      const pageSize = loaded < 128 ? 32 : 512
      const request = store.getAll(bounds, pageSize)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        try {
          const found = request.result as T[]
          rows.push(...found)
          loaded += found.length
          if (found.length < pageSize) return resolve(rows)
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
