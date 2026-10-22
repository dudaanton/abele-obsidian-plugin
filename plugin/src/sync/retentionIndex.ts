import { completion, wait } from './idbRequests'

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export interface RetentionSummary {
  count: number
  bytes: number
  earliestExpiry: number | null
  migrated: boolean
}
export interface RetentionRecord {
  id: string
  at: number
  size: number
  intent: unknown
}
export interface RetentionIndex {
  summary(): Promise<RetentionSummary>
  put(record: RetentionRecord): Promise<void>
  drop(id: string): Promise<void>
  oldest(): Promise<RetentionRecord | undefined>
  find(id: string): Promise<RetentionRecord | undefined>
  migrated(): Promise<void>
}
export const emptyRetention = (): RetentionSummary => ({
  count: 0,
  bytes: 0,
  earliestExpiry: null,
  migrated: false,
})

/** Header and ordered rows publish in the same short native transaction. No filesystem IO here. */
export class IndexedRetention implements RetentionIndex {
  private readonly prefix: string
  constructor(
    private readonly db: IDBDatabase,
    private readonly namespace: string,
    root: string
  ) {
    this.prefix = '!retention:' + root + ':'
  }
  private async run<T>(write: boolean, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const tx = this.db.transaction('host', write ? 'readwrite' : 'readonly')
    const done = completion(tx, 'retention index')
    try {
      const result = await work(tx.objectStore('host'))
      await done
      return result
    } catch (error) {
      try {
        tx.abort()
      } catch {
        /* already settled */
      }
      await done.catch(() => {})
      throw error
    }
  }
  private async get<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
    return (await wait<{ value: T } | undefined>(store.get([this.namespace, this.prefix + key])))
      ?.value
  }
  private save(store: IDBObjectStore, key: string, value: unknown) {
    return wait(store.put({ namespace: this.namespace, key: this.prefix + key, value }))
  }
  private first(store: IDBObjectStore): Promise<RetentionRecord | undefined> {
    return new Promise((resolve, reject) => {
      const request = store.openKeyCursor()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(undefined)
          return
        }
        const [namespace, key] = cursor.primaryKey as string[]
        if (
          namespace < this.namespace ||
          (namespace === this.namespace && key < this.prefix + '0')
        ) {
          cursor.continue([this.namespace, this.prefix + '0'])
          return
        }
        if (namespace !== this.namespace || key > this.prefix + '9\uffff') {
          resolve(undefined)
          return
        }
        const row = store.get(cursor.primaryKey)
        row.onerror = () => reject(row.error)
        row.onsuccess = () => resolve(row.result?.value)
      }
    })
  }
  summary(): Promise<RetentionSummary> {
    return this.run(
      false,
      async (s) => (await this.get<RetentionSummary>(s, '!summary')) ?? emptyRetention()
    )
  }
  oldest(): Promise<RetentionRecord | undefined> {
    return this.run(false, (s) => this.first(s))
  }
  find(id: string): Promise<RetentionRecord | undefined> {
    return this.run(false, (s) => this.get(s, '!id:' + id))
  }
  private row(record: RetentionRecord) {
    return Math.max(0, record.at).toString().padStart(16, '0') + ':' + record.id
  }
  private change(record: RetentionRecord | undefined, id: string): Promise<void> {
    return this.run(true, async (s) => {
      const header = (await this.get<RetentionSummary>(s, '!summary')) ?? emptyRetention()
      const old = await this.get<RetentionRecord>(s, '!id:' + id)
      if (old) {
        await wait(s.delete([this.namespace, this.prefix + this.row(old)]))
        header.count--
        header.bytes -= old.size
      }
      if (record) {
        await this.save(s, this.row(record), record)
        await this.save(s, '!id:' + id, record)
        header.count++
        header.bytes += record.size
      } else await wait(s.delete([this.namespace, this.prefix + '!id:' + id]))
      const first = await this.first(s)
      header.earliestExpiry = first ? first.at + RETENTION_MS : null
      await this.save(s, '!summary', header)
    })
  }
  put(record: RetentionRecord): Promise<void> {
    return this.change(record, record.id)
  }
  drop(id: string): Promise<void> {
    return this.change(undefined, id)
  }
  migrated(): Promise<void> {
    return this.run(true, async (s) => {
      const header = (await this.get<RetentionSummary>(s, '!summary')) ?? emptyRetention()
      header.migrated = true
      await this.save(s, '!summary', header)
    })
  }
}

/** Hosts without durable storage retain files conservatively; this index is a cache only. */
export class MemoryRetention implements RetentionIndex {
  private readonly rows = new Map<string, RetentionRecord>()
  private header = emptyRetention()
  async summary() {
    return { ...this.header }
  }
  async oldest() {
    return [...this.rows.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))[0]
  }
  async find(id: string) {
    return this.rows.get(id)
  }
  async put(record: RetentionRecord) {
    this.rows.set(record.id, record)
    await this.refresh()
  }
  async drop(id: string) {
    this.rows.delete(id)
    await this.refresh()
  }
  async migrated() {
    this.header.migrated = true
  }
  private async refresh() {
    const first = await this.oldest()
    this.header = {
      ...this.header,
      count: this.rows.size,
      bytes: [...this.rows.values()].reduce((n, r) => n + r.size, 0),
      earliestExpiry: first ? first.at + RETENTION_MS : null,
    }
  }
}
