import type { App } from 'obsidian'
import type { LocalStorage } from './ledgerId'
import { completion, connectTo, wait } from './idbRequests'
import {
  hostChanges,
  joinHostValue,
  mergeHostChange,
  normalizeHostHeader,
  splitHostValue,
  type HostChange,
  type HostRecord,
} from './hostSyncRecords'

// This database never participates in an SDK overlay transaction.
const DATABASE = 'abele-sync-host-v1'
const STORE = 'host'
const RECORDS = 'host-records'
const RECORDS_MIGRATED = '!records-migrated'
const MIGRATED = '!migrated'
const KEYS = [
  'abele-sync-writes',
  'abele-sync-recovered-writes',
  'abele-sync-connections-v2',
  'abele-sync-item-connections-v1',
  'abele-sync-item-selection-v1',
  'abele-sync-registry-write-v1',
  'abele-sync-connection-sets-v1',
]
const prepared = new WeakMap<LocalStorage, HostSyncStorage>()
const parents = new WeakMap<LocalStorage, LocalStorage>()
const backend = (local: LocalStorage): HostSyncStorage | undefined => {
  if (local instanceof HostSyncStorage) return local
  const own = prepared.get(local)
  if (own) return own
  const parent = parents.get(local)
  return parent ? backend(parent) : undefined
}
export const hostStorageOf = (local: LocalStorage): LocalStorage => backend(local) ?? local
export function linkHostStorage(alias: LocalStorage, local: LocalStorage): void {
  parents.set(alias, local)
}
export function inheritHostStorage<T extends LocalStorage>(alias: T, local: LocalStorage): T {
  linkHostStorage(alias, local)
  return alias
}
export const flushHostStorage = async (local: LocalStorage): Promise<void> => {
  const store = backend(local)
  await store?.flush()
}

/** Hydrated synchronous view; callers must await flush before any dependent effect. */
export class HostSyncStorage implements LocalStorage {
  private readonly values = new Map<string, unknown>()
  private pending: HostChange[] = []
  private tail: Promise<void> = Promise.resolve()
  private running: Promise<void> | undefined
  private scheduled = false
  private closed = false
  get isClosed(): boolean {
    return this.closed
  }
  private constructor(
    private readonly db: IDBDatabase,
    private readonly namespace: string,
    private readonly local: LocalStorage
  ) {}

  static async open(
    factory: IDBFactory,
    namespace: string,
    local: LocalStorage
  ): Promise<HostSyncStorage> {
    if (!namespace) throw new Error('Sync host storage requires a vault identity')
    const db = await connectTo(
      factory,
      DATABASE,
      (db) => {
        if (!db.objectStoreNames.contains(STORE))
          db.createObjectStore(STORE, { keyPath: ['namespace', 'key'] })
        const records = db.createObjectStore(RECORDS, { keyPath: ['namespace', 'key', 'id'] })
        records.createIndex('group', ['namespace', 'key'])
      },
      (db) => db.close(),
      2
    )
    const result = new HostSyncStorage(db, namespace, local)
    let transaction: IDBTransaction | undefined
    let committed: Promise<void> | undefined
    try {
      const tx = db.transaction([STORE, RECORDS], 'readwrite')
      transaction = tx
      const done = completion(tx, 'cannot migrate sync host storage')
      committed = done
      void done.catch(() => {})
      const rows = tx.objectStore(STORE)
      const records = tx.objectStore(RECORDS)
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
          result.values.set(
            key,
            joinHostValue(await wait<HostRecord[]>(records.index('group').getAll([namespace, key])))
          )
        } else {
          let order = 0
          for (const [id, item] of splitHostValue(key, value))
            await wait(records.put({ namespace, key, id, value: item, order: order++ }))
          result.values.set(key, value)
        }
        if (!marker) await wait(rows.put({ namespace, key, value }))
      }
      if (!marker) await wait(rows.put({ namespace, key: MIGRATED, value: true }))
      if (!recordMarker) await wait(rows.put({ namespace, key: RECORDS_MIGRATED, value: true }))
      await done
      // Only a compatibility view. On every reopen the committed IDB rows win.
      for (const [key, value] of result.values) local.saveLocalStorage(key, structuredClone(value))
      prepared.set(local, result)
      return result
    } catch (error) {
      try {
        transaction?.abort()
      } catch {
        /* May already be committed. */
      }
      await committed?.catch(() => {})
      db.close()
      throw error
    }
  }
  loadLocalStorage(key: string): unknown {
    return this.values.has(key)
      ? structuredClone(this.values.get(key))
      : this.local.loadLocalStorage(key)
  }
  saveLocalStorage(key: string, value: unknown): void {
    if (this.closed) throw new Error('Sync host storage is closed')
    if (this.values.has(key)) {
      const copy = structuredClone(value)
      this.pending = this.pending.concat(hostChanges(key, this.values.get(key), copy))
      this.values.set(key, copy)
    }
    this.local.saveLocalStorage(key, value)
    // Ordinary settings/status saves also drain without waiting for another file exchange.
    // Dependent effects still await flush explicitly and receive any commit failure.
    if (this.values.has(key) && !this.scheduled) {
      this.scheduled = true
      queueMicrotask(() => {
        this.scheduled = false
        if (this.pending.length && !this.closed) void this.flush().catch(() => {})
      })
    }
  }
  flush(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Sync host storage is closed'))
    if (!this.pending.length) return this.running ?? Promise.resolve()
    const changes = this.pending
    this.pending = []
    const snapshots = new Map(this.values)
    const running = this.tail.then(() => this.commit(changes, snapshots))
    this.running = running
    this.tail = running.catch(() => {})
    const settled = () => {
      if (this.running === running) this.running = undefined
    }
    void running.then(settled, settled)
    return running
  }

  private async commit(changes: HostChange[], snapshots: Map<string, unknown>): Promise<void> {
    const tx = this.db.transaction(RECORDS, 'readwrite')
    const done = completion(tx, 'cannot commit sync host records')
    void done.catch(() => {})
    const groups = new Map<string, Map<string, HostRecord>>()
    try {
      const store = tx.objectStore(RECORDS)
      for (const key of new Set(changes.map((change) => change.key))) {
        const rows = await wait<HostRecord[]>(store.index('group').getAll([this.namespace, key]))
        groups.set(key, new Map(rows.map((row) => [row.id, row])))
      }
      for (const change of changes) {
        const group = groups.get(change.key)
        if (!group) throw new Error('Sync host transaction group is missing')
        const prior = group.get(change.id)
        const value = mergeHostChange(change, prior?.value)
        if (value === undefined) {
          await wait(store.delete([this.namespace, change.key, change.id]))
          group.delete(change.id)
        } else {
          const row: HostRecord = {
            namespace: this.namespace,
            key: change.key,
            id: change.id,
            value,
            order:
              prior?.order ??
              [...group.values()].reduce((next, row) => Math.max(next, row.order + 1), 0),
          }
          await wait(store.put(row))
          group.set(row.id, row)
        }
      }
      for (const [key, group] of groups) {
        const selection = normalizeHostHeader(key, group)
        if (selection) {
          await wait(store.put(selection))
          group.set(selection.id, selection)
        }
        // The synchronous registry repair sequence must land as one host transaction.
        if (key === 'abele-sync-registry-write-v1' && joinHostValue([...group.values()]) != null)
          throw new Error('Unfinished registry update requires retry before host commit')
      }
      await done
      for (const [key, group] of groups)
        if (this.values.get(key) === snapshots.get(key))
          this.values.set(key, joinHostValue([...group.values()]))
    } catch (error) {
      try {
        tx.abort()
      } catch {
        /* Already settled. */
      }
      await done.catch(() => {})
      // Drop this failed attempt only. Later queue entries retain their own result and delta.
      const read = this.db.transaction(RECORDS, 'readonly').objectStore(RECORDS)
      const restored = await Promise.all(
        [...snapshots.keys()].map(
          async (key) =>
            [
              key,
              await wait<HostRecord[]>(read.index('group').getAll([this.namespace, key])),
            ] as const
        )
      )
      for (const [key, rows] of restored)
        if (this.values.get(key) === snapshots.get(key)) this.values.set(key, joinHostValue(rows))
      throw error
    }
  }
  close(): void {
    this.closed = true
    this.db.close()
  }
}

/** Obsidian's appId is the host's local vault identity, independent of synced files. */
export async function prepareHostSyncStorage(
  app: App,
  factory: IDBFactory
): Promise<HostSyncStorage> {
  const existing = prepared.get(app)
  if (existing && !existing.isClosed) return existing
  const identity = (app as App & { appId?: string }).appId
  if (typeof identity !== 'string' || !identity)
    throw new Error('Sync host vault identity is unavailable')
  return HostSyncStorage.open(factory, identity, app)
}
