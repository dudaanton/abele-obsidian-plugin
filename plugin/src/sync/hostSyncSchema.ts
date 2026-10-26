import type { LocalStorage } from './ledgerId'
import { completion, connectTo, wait } from './idbRequests'
import { hostJournalPath, joinHostValue, splitHostValue, type HostRecord } from './hostSyncRecords'

// This database never participates in an SDK overlay transaction.
export const DATABASE = 'abele-sync-host-v1'
export const STORE = 'host'
const LEGACY_RECORDS = 'host-records'
export const RECORDS = 'host-records-v3'
export const recordKey = (namespace: string, key: string, id: string): string =>
  JSON.stringify([namespace, key, id])
const PATHS_MIGRATED = '!paths-migrated'
const RECORDS_MIGRATED = '!records-migrated'
const MIGRATED = '!migrated'
export const journalKey = (key: string): boolean =>
  key === 'abele-sync-writes' || key === 'abele-sync-recovered-writes'

/** The primary key already groups rows by namespace and document. A seek avoids
 * maintaining a redundant secondary index on every journal retirement. */
export function readGroup(
  store: IDBObjectStore,
  namespace: string,
  key: string,
  first?: (row: HostRecord) => boolean
): Promise<HostRecord[]> {
  return new Promise((resolve, reject) => {
    const rows: HostRecord[] = []
    const prefix = JSON.stringify([namespace, key]).slice(0, -1) + ','
    const request = store.openCursor()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(rows)
        return
      }
      const heldKey = cursor.primaryKey as string
      if (heldKey < prefix) {
        cursor.continue(prefix)
        return
      }
      if (!heldKey.startsWith(prefix)) {
        resolve(rows)
        return
      }
      const row = cursor.value as HostRecord
      if (!first || first(row)) rows.push(row)
      if (first && rows.length) resolve(rows)
      else cursor.continue()
    }
  })
}
const KEYS = [
  'abele-sync-writes',
  'abele-sync-recovered-writes',
  'abele-sync-connections-v2',
  'abele-sync-item-connections-v1',
  'abele-sync-item-selection-v1',
  'abele-sync-registry-write-v1',
  'abele-sync-connection-sets-v1',
]

export function openHostDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return connectTo(
    factory,
    DATABASE,
    (db) => {
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: ['namespace', 'key'] })
      if (!db.objectStoreNames.contains(LEGACY_RECORDS)) {
        db.createObjectStore(LEGACY_RECORDS, { keyPath: ['namespace', 'key', 'id'] }).createIndex(
          'group',
          ['namespace', 'key']
        )
      }
      const indexed = db.createObjectStore(RECORDS, { keyPath: 'keyId' })
      indexed.createIndex('path', ['namespace', 'key', 'path'])
      indexed.createIndex('target', ['namespace', 'key', 'target'])
    },
    (db) => db.close(),
    3
  )
}

/** Brings this namespace's rows to the current schema and returns the committed view of
 * every key, in order. Migration and its markers commit together; the legacy copy stays
 * intact until COMMIT, and nothing is returned unless it committed. */
export async function migrateHostStorage(
  db: IDBDatabase,
  namespace: string,
  local: LocalStorage
): Promise<[string, unknown][]> {
  const views: [string, unknown][] = []
  let transaction: IDBTransaction | undefined
  let committed: Promise<void> | undefined
  try {
    const tx = db.transaction([STORE, LEGACY_RECORDS, RECORDS], 'readwrite')
    transaction = tx
    const done = completion(tx, 'cannot migrate sync host storage')
    committed = done
    void done.catch(() => {})
    const rows = tx.objectStore(STORE)
    const records = tx.objectStore(RECORDS)
    const pathMarker = await wait<{ value: unknown } | undefined>(
      rows.get([namespace, PATHS_MIGRATED])
    )
    if (pathMarker && pathMarker.value !== true)
      throw new Error('Sync host path migration requires recovery')
    const marker = await wait<{ value: unknown } | undefined>(rows.get([namespace, MIGRATED]))
    if (marker && marker.value !== true)
      throw new Error('Sync host migration marker requires recovery')
    const recordMarker = await wait<{ value: unknown } | undefined>(
      rows.get([namespace, RECORDS_MIGRATED])
    )
    if (recordMarker && recordMarker.value !== true)
      throw new Error('Sync host record migration requires recovery')
    // Migration and its marker commit together. Leave the legacy copy intact until COMMIT.
    for (const key of KEYS) {
      const row = marker
        ? await wait<{ value: unknown } | undefined>(rows.get([namespace, key]))
        : undefined
      if (marker && !row) throw new Error('Sync host storage is incomplete; recovery is required')
      const value = marker
        ? (row?.value ?? null)
        : structuredClone(local.loadLocalStorage(key) ?? null)
      if (recordMarker) {
        const loaded = pathMarker
          ? await readGroup(records, namespace, key)
          : await wait<HostRecord[]>(
              tx.objectStore(LEGACY_RECORDS).index('group').getAll([namespace, key])
            )
        for (const row of loaded) row.keyId = recordKey(namespace, key, row.id)
        // Earlier schema-2 writers did not maintain an append counter on the header.
        // Repair it during the already-required hydration, in this same transaction.
        const header = loaded.find((row) => row.id === '!header')
        const next = loaded.reduce(
          (next, row) => (row.id === '!header' ? next : Math.max(next, row.order + 1)),
          0
        )
        if (header && header.order < next) {
          header.order = next
          await wait(records.put(header))
        }
        if (!pathMarker)
          for (const row of loaded) {
            row.path = hostJournalPath(key, row.value)
            if (row.path !== undefined) {
              row.target = (row.value as { target: string }).target
            }
            await wait(records.put(row))
          }
        views.push([key, joinHostValue(loaded)])
      } else {
        let order = 0
        for (const [id, item] of splitHostValue(key, value)) {
          const path = hostJournalPath(key, item)
          await wait(
            records.put({
              keyId: recordKey(namespace, key, id),
              namespace,
              key,
              id,
              value: item,
              order: order++,
              path,
              target: path === undefined ? undefined : (item as { target: string }).target,
            })
          )
        }
        views.push([key, value])
      }
      if (!marker) await wait(rows.put({ namespace, key, value }))
    }
    if (!marker) await wait(rows.put({ namespace, key: MIGRATED, value: true }))
    if (!recordMarker) await wait(rows.put({ namespace, key: RECORDS_MIGRATED, value: true }))
    if (!pathMarker) await wait(rows.put({ namespace, key: PATHS_MIGRATED, value: true }))
    await done
    return views
  } catch (error) {
    try {
      transaction?.abort()
    } catch {
      /* May already be committed. */
    }
    await committed?.catch(() => {})
    throw error
  }
}
