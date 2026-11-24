import type { HostChange } from './hostSyncRecords'
import { STORE } from './hostSyncSchema'
import { completion, wait } from './idbRequests'

export const SNAPSHOT_RETRY_PREFIX = '!snapshot-retry:'
export function snapshotChanges(batch: readonly HostChange[]): HostChange[] {
  const retries = new Map<string, HostChange>()
  for (const change of batch) {
    if (
      change.key !== 'abele-sync-settings-sections-v1' &&
      change.key !== 'abele-external-last-opened-v1'
    )
      continue
    const id = JSON.stringify([change.key, change.id])
    const prior = retries.get(id)
    retries.set(id, { ...change, before: prior ? prior.before : change.before })
  }
  return [...retries.values()]
}

export async function stageSnapshotRetry(
  db: IDBDatabase,
  namespace: string,
  key: string,
  value: HostChange[]
): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite')
  const done = completion(tx, 'cannot retain pending settings snapshots')
  void done.catch(() => {})
  try {
    await wait(tx.objectStore(STORE).put({ namespace, key, value }))
    await done
  } catch (error) {
    try {
      tx.abort()
    } catch {
      /* Already settled. */
    }
    await done.catch(() => {})
    throw error
  }
}

export async function readSnapshotRetries(
  db: IDBDatabase,
  namespace: string
): Promise<{ key: string; value: HostChange[] }[]> {
  const tx = db.transaction(STORE, 'readonly')
  return new Promise((resolve, reject) => {
    const rows: { key: string; value: HostChange[] }[] = []
    const request = tx.objectStore(STORE).openCursor()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(rows)
        return
      }
      const [scope, key] = cursor.primaryKey as [string, string]
      if (scope < namespace || (scope === namespace && key < SNAPSHOT_RETRY_PREFIX)) {
        cursor.continue([namespace, SNAPSHOT_RETRY_PREFIX])
        return
      }
      if (scope !== namespace || !key.startsWith(SNAPSHOT_RETRY_PREFIX)) {
        resolve(rows)
        return
      }
      const value: unknown = cursor.value.value
      if (
        !Array.isArray(value) ||
        value.some(
          (row) =>
            !row ||
            typeof row !== 'object' ||
            typeof row.key !== 'string' ||
            row.id !== '!header' ||
            !row.after ||
            typeof row.after !== 'object'
        ) ||
        snapshotChanges(value).length !== value.length
      ) {
        reject(new Error('Pending settings snapshots require recovery'))
        return
      }
      rows.push({ key, value })
      cursor.continue()
    }
  })
}
