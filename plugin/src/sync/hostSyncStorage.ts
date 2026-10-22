import type { App } from 'obsidian'
import type { LocalStorage } from './ledgerId'
import { completion, connectTo, wait } from './idbRequests'

// This database never participates in an SDK overlay transaction.
const DATABASE = 'abele-sync-host-v1'
const STORE = 'host'
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
  private readonly dirty = new Map<string, unknown>()
  private tail: Promise<void> = Promise.resolve()
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
        db.createObjectStore(STORE, { keyPath: ['namespace', 'key'] })
      },
      (db) => db.close()
    )
    const result = new HostSyncStorage(db, namespace, local)
    let transaction: IDBTransaction | undefined
    let committed: Promise<void> | undefined
    try {
      const tx = db.transaction(STORE, 'readwrite')
      transaction = tx
      const done = completion(tx, 'cannot migrate sync host storage')
      committed = done
      void done.catch(() => {})
      const rows = tx.objectStore(STORE)
      const marker = await wait<{ value: unknown } | undefined>(rows.get([namespace, MIGRATED]))
      if (marker && marker.value !== true)
        throw new Error('Sync host migration marker requires recovery')
      // Migration and its marker commit together. Leave the legacy copy intact until COMMIT.
      for (const key of KEYS) {
        const row = marker
          ? await wait<{ value: unknown } | undefined>(rows.get([namespace, key]))
          : undefined
        if (marker && !row) throw new Error('Sync host storage is incomplete; recovery is required')
        const value = marker
          ? (row?.value ?? null)
          : structuredClone(local.loadLocalStorage(key) ?? null)
        result.values.set(key, value)
        if (!marker) await wait(rows.put({ namespace, key, value }))
      }
      if (!marker) await wait(rows.put({ namespace, key: MIGRATED, value: true }))
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
      this.values.set(key, copy)
      this.dirty.set(key, copy)
    }
    this.local.saveLocalStorage(key, value)
    // Ordinary settings/status saves also drain without waiting for another file exchange.
    // Dependent effects still await flush explicitly and receive any commit failure.
    if (this.values.has(key)) void this.flush().catch(() => {})
  }
  flush(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Sync host storage is closed'))
    this.tail = this.tail.then(async () => {
      while (this.dirty.size) {
        const writes = [...this.dirty]
        const tx = this.db.transaction(STORE, 'readwrite')
        const done = completion(tx, 'cannot commit sync host storage')
        void done.catch(() => {})
        try {
          for (const [key, value] of writes)
            tx.objectStore(STORE).put({ namespace: this.namespace, key, value })
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
        for (const [key, value] of writes) if (this.dirty.get(key) === value) this.dirty.delete(key)
      }
    })
    void this.tail.catch(() => {})
    return this.tail
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
