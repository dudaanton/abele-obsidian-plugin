const families = [
  'abele-node-session-owner-mode:',
  'abele-slide-network:',
  'abele-script-provenance-retired:',
]
type LegacyStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>

/** Device/vault intent and evidence, not sync state. No per-id in-memory cache. */
export class DeviceIntentStore {
  private readonly prefix: string
  private readonly database: string
  constructor(
    app: object,
    private readonly factory: IDBFactory = window.indexedDB,
    private readonly legacy: LegacyStorage = window.localStorage
  ) {
    const id = (app as { appId?: string }).appId
    if (!id) throw new Error('Device intent storage requires a vault identity')
    this.prefix = id + '-'
    this.database = 'abele-device-intent:' + id
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.database, 1)
      let blocked = false
      request.onupgradeneeded = () => {
        request.result.createObjectStore('values')
        request.result.createObjectStore('legacy')
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => {
        blocked = true
        reject(new Error('Device intent database is blocked'))
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => db.close()
        if (blocked) db.close()
        else resolve(db)
      }
    })
  }

  private run<T>(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction, result: (value: T) => void) => void
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      // Legacy sources are retired only after a disk-durable commit. Never retry
      // imports with relaxed durability if the host rejects this request.
      const tx = db.transaction(
        ['values', 'legacy'],
        mode,
        mode === 'readwrite' ? { durability: 'strict' } : undefined
      )
      let result: T
      tx.oncomplete = () => resolve(result)
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error('Device intent transaction aborted'))
      work(tx, (value) => {
        result = value
      })
    })
  }

  private assertKey(key: string): void {
    if (!families.some((family) => key.startsWith(family)))
      throw new Error('Unknown device intent key')
  }

  private async migrateKey(db: IDBDatabase, key: string): Promise<void> {
    this.assertKey(key)
    const raw = this.legacy.getItem(this.prefix + key)
    if (raw === null) return
    await this.run<void>(db, 'readwrite', (tx) => {
      const values = tx.objectStore('values')
      const get = values.get(key)
      get.onsuccess = () => {
        if (get.result === undefined) values.put(raw, key)
        else if (get.result !== raw) tx.objectStore('legacy').put(raw, [key, raw])
      }
    })
    // A restart after commit must not resurrect an older mirror. Conflicting legacy
    // bytes are retained separately as evidence, never adopted over durable intent.
    try {
      if (this.legacy.getItem(this.prefix + key) === raw) this.legacy.removeItem(this.prefix + key)
    } catch (error) {
      console.debug('[Abele] Device intent legacy cleanup pending', error)
    }
  }

  async migrate(): Promise<void> {
    const keys = Array.from({ length: this.legacy.length }, (_, i) => this.legacy.key(i))
      .filter((key): key is string => !!key && key.startsWith(this.prefix))
      .map((key) => key.slice(this.prefix.length))
      .filter((key) => families.some((family) => key.startsWith(family)))
    if (!keys.length) return
    const db = await this.open()
    try {
      for (const key of keys) await this.migrateKey(db, key)
    } finally {
      db.close()
    }
  }

  async readRaw(key: string): Promise<string | undefined> {
    this.assertKey(key)
    const db = await this.open()
    try {
      await this.migrateKey(db, key)
      return await this.run<string | undefined>(db, 'readonly', (tx, result) => {
        const get = tx.objectStore('values').get(key)
        get.onsuccess = () => result(get.result as string | undefined)
      })
    } finally {
      db.close()
    }
  }

  async read(key: string): Promise<unknown> {
    const raw = await this.readRaw(key)
    return raw === undefined ? undefined : (JSON.parse(raw) as unknown)
  }

  async write(key: string, value: unknown): Promise<void> {
    this.assertKey(key)
    const raw = JSON.stringify(value)
    if (raw === undefined) throw new Error('Device intent is not serializable')
    const db = await this.open()
    try {
      await this.migrateKey(db, key)
      await this.run<void>(db, 'readwrite', (tx) => {
        tx.objectStore('values').put(raw, key)
      })
    } finally {
      db.close()
    }
  }

  /** Conflicting mirrors survive migration for explicit recovery/inspection. */
  async legacyValues(key: string): Promise<string[]> {
    this.assertKey(key)
    const db = await this.open()
    try {
      return await this.run<string[]>(db, 'readonly', (tx, result) => {
        const rows: string[] = []
        const cursor = tx.objectStore('legacy').openCursor()
        cursor.onsuccess = () => {
          const row = cursor.result
          if (!row) {
            result(rows)
            return
          }
          if (Array.isArray(row.key) && row.key[0] === key) rows.push(row.value as string)
          row.continue()
        }
      })
    } finally {
      db.close()
    }
  }
}
