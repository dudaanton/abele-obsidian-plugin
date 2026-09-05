import { EngineError, type Journal, type StateEntry, type StateStore } from '@abele/sync-core'

/**
 * One version. The schema below is the whole of it; changing it needs a new version and an
 * `onupgradeneeded` that migrates what is already on the user's disk.
 */
const DB_VERSION = 1

const ENTRIES = 'entries'
const META = 'meta'
const BY_FILE_ID = 'byFileId'
const BY_WIRE_PATH = 'byWirePath'

/** The engine's own two rows in `meta`; `getMeta`/`setMeta` cannot reach either. */
const CURSOR_KEY = 'cursor'
const JOURNAL_KEY = 'journal'

/** A plugin key, kept clear of the engine's two: `plugin:<key>`, as the daemon writes `daemon:`. */
const own = (key: string): string => `plugin:${key}`

/** The database one vault's state lives in. One vault, one database, one name. */
export const stateDatabaseName = (vaultId: string): string => `abele-sync-${vaultId}`

/** A row of `meta`: whatever was written under that key, structured-cloned in and out. */
interface MetaRow {
  key: string
  value: unknown
}

/**
 * What an open `transaction` has written and not yet committed.
 *
 * `null` is a delete in both maps — no entry is null and no meta value is, since clearing the
 * journal or a plugin key is spelled as removing the row.
 */
interface Overlay {
  entries: Map<string, StateEntry | null>
  meta: Map<string, unknown>
  /** 1 for the outermost `transaction`; a nested one joins it and counts up. */
  depth: number
}

/**
 * The plugin's state, in IndexedDB.
 *
 * This is the WebView's own storage and nothing else: no Node, no filesystem, no data file the
 * user could see grow to a megabyte per thousand notes. One vault is one database
 * (`abele-sync-<vaultId>`), so forgetting a vault is `IndexedDbStateStore.delete`.
 *
 * Three keys index one entry, as in the daemon's SQLite store: `path` is what a row is stored
 * under, and `fileId` and `wirePath` are unique — `put` clears any *other* row holding the same
 * `fileId` or `wirePath` before writing, so a crash between a move's put and its delete cannot
 * leave two rows claiming one file. That is stricter than `MemoryStateStore`, which leaves the
 * old row behind for the caller to delete.
 *
 * ## Transactions are an overlay, not an IDB transaction
 *
 * An IndexedDB transaction commits itself the moment no request of its own is pending, so one
 * cannot span the engine's awaits — the engine hashes a file or waits on the network inside
 * `transaction(...)`, and the browser would have committed long before. So `transaction(fn)`
 * opens no IDB transaction at all. It buffers every `put`, `delete`, cursor, journal and meta
 * write `fn` makes in an in-memory overlay that every read inside `fn` consults first —
 * `get`, `byFileId`, `all` and the meta accessors all see what was written, exactly as they
 * would inside a real transaction. Nothing is loaded eagerly: a read the overlay does not hold
 * still goes to the database.
 *
 * When `fn` returns, the whole overlay is written in **one** readwrite IDB transaction over
 * both stores, which either lands whole or aborts whole. When `fn` throws, the overlay is
 * dropped and the error is rethrown, and the database was never touched. A nested
 * `transaction` joins the outer one and commits nothing of its own, the way the daemon's
 * nesting is counted rather than saved: an inner throw the caller swallows leaves the inner
 * writes in the outer overlay — the engine lets every failure out, which is what makes that
 * safe.
 *
 * What this model does not give is isolation from another writer between `fn`'s first read and
 * the commit, which a real transaction would. Nothing else writes this database: one plugin
 * instance per vault owns it, and a second window of the same vault is the same instance.
 *
 * Every failure the API raises comes back as `EngineError('io', …)`. IndexedDB has no lock a
 * caller could retry — an aborted transaction is a full disk, a closed connection or a browser
 * that evicted the origin's storage, and all of those are `io`.
 */
export class IndexedDbStateStore implements StateStore {
  /** Non-null exactly while a `transaction` is open. */
  private overlay: Overlay | null = null

  private constructor(private readonly db: IDBDatabase) {}

  /**
   * Opens (and creates) the database and its stores. The factory is passed in rather than
   * taken from the window so a test can hand over its own and two tests never share one.
   */
  static open(indexedDB: IDBFactory, name: string): Promise<IndexedDbStateStore> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = indexedDB.open(name, DB_VERSION)
      } catch (cause) {
        reject(new EngineError('io', `cannot open the state database ${name}`, cause))
        return
      }
      request.onupgradeneeded = () => build(request.result)
      request.onblocked = () => {
        // Another connection holds the old version. It is asked to close below; this only
        // says why the open is taking so long.
        console.debug(`[abele-sync] the state database ${name} is held open elsewhere`)
      }
      request.onerror = () =>
        reject(new EngineError('io', `cannot open the state database ${name}`, request.error))
      request.onsuccess = () => {
        const db = request.result
        // A `delete` or a version bump from another window must not hang on this connection.
        db.onversionchange = () => {
          console.debug(`[abele-sync] closing the state database ${name}: another window wants it`)
          db.close()
        }
        resolve(new IndexedDbStateStore(db))
      }
    })
  }

  /**
   * Forgets a vault entirely. Every connection to the database must be closed first — the
   * delete waits for the ones that are not, and says so.
   */
  static delete(indexedDB: IDBFactory, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = indexedDB.deleteDatabase(name)
      } catch (cause) {
        reject(new EngineError('io', `cannot forget the state database ${name}`, cause))
        return
      }
      request.onblocked = () => {
        console.debug(`[abele-sync] waiting to forget ${name}: it is still open somewhere`)
      }
      request.onerror = () =>
        reject(new EngineError('io', `cannot forget the state database ${name}`, request.error))
      request.onsuccess = () => resolve()
    })
  }

  close(): void {
    this.db.close()
  }

  async get(path: string): Promise<StateEntry | null> {
    const overlaid = this.overlay?.entries.get(path)
    if (overlaid !== undefined) return copyEntry(overlaid)
    return this.read(`cannot read the state of ${path}`, [ENTRIES], async (tx) =>
      copyEntry(await wait<StateEntry | undefined>(tx.objectStore(ENTRIES).get(path)))
    )
  }

  async byFileId(fileId: string): Promise<StateEntry | null> {
    const overlay = this.overlay
    if (overlay) {
      for (const entry of overlay.entries.values()) {
        if (entry !== null && entry.fileId === fileId) return copyEntry(entry)
      }
    }
    const rows = await this.read(`cannot read the state of ${fileId}`, [ENTRIES], async (tx) =>
      wait<StateEntry[]>(tx.objectStore(ENTRIES).index(BY_FILE_ID).getAll(fileId))
    )
    // A row the overlay holds a newer word on was either deleted or rewritten under another
    // fileId; the loop above already answered for the rewrite that still matches.
    return copyEntry(rows.find((row) => !overlay?.entries.has(row.path)))
  }

  async *all(): AsyncIterable<StateEntry> {
    // Every row up front: the caller may await between steps, and an IDB cursor held across an
    // await sees its transaction commit out from under the walk.
    const rows = await this.read('cannot read the state', [ENTRIES], async (tx) =>
      wait<StateEntry[]>(tx.objectStore(ENTRIES).getAll())
    )
    const overlay = this.overlay
    const merged = overlay
      ? [
          ...rows.filter((row) => !overlay.entries.has(row.path)),
          ...[...overlay.entries.values()].filter((entry) => entry !== null),
        ]
      : rows
    for (const row of merged) yield { ...row }
  }

  /**
   * Upserts by `path`, and leaves this file with exactly one row: any other row claiming its
   * `fileId` or its `wirePath` is removed in the same step, so the two can never both be there.
   */
  async put(entry: StateEntry): Promise<void> {
    const copy = { ...entry }
    const overlay = this.overlay
    if (overlay) {
      for (const [path, other] of overlay.entries) {
        if (path !== copy.path && other !== null && clashes(other, copy)) {
          overlay.entries.set(path, null)
        }
      }
      const held = await this.read(`cannot record ${copy.path}`, [ENTRIES], async (tx) =>
        clashingKeys(tx.objectStore(ENTRIES), copy)
      )
      for (const path of held) if (path !== copy.path) overlay.entries.set(path, null)
      overlay.entries.set(copy.path, copy)
      return
    }
    await this.write(`cannot record ${copy.path}`, [ENTRIES], async (tx) => {
      const entries = tx.objectStore(ENTRIES)
      for (const path of await clashingKeys(entries, copy)) {
        if (path !== copy.path) await wait(entries.delete(path))
      }
      await wait(entries.put(copy))
    })
  }

  async delete(path: string): Promise<void> {
    if (this.overlay) {
      this.overlay.entries.set(path, null)
      return
    }
    await this.write(`cannot forget ${path}`, [ENTRIES], async (tx) =>
      wait(tx.objectStore(ENTRIES).delete(path))
    )
  }

  async getCursor(): Promise<number> {
    const value = await this.metaValue(CURSOR_KEY)
    if (value === null) return 0
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EngineError('io', 'the stored cursor is not a number')
    }
    return value
  }

  async setCursor(seq: number): Promise<void> {
    await this.setMetaValue('cannot record the cursor', CURSOR_KEY, seq)
  }

  async getJournal(): Promise<Journal | null> {
    const value = await this.metaValue(JOURNAL_KEY)
    if (value === null) return null
    if (typeof value !== 'object')
      throw new EngineError('io', 'the stored journal is not an object')
    // A copy either way: out of the database it is already a clone, out of the overlay it is
    // the object the engine handed over, and the engine appends to an open journal in place.
    return copyJournal(value as Journal)
  }

  async setJournal(j: Journal | null): Promise<void> {
    await this.setMetaValue('cannot record the journal', JOURNAL_KEY, copyJournal(j))
  }

  /**
   * What the plugin itself remembers beside the engine's cursor and journal: one string under
   * one key, or `null` when nothing was written under it. Keys are prefixed, so a plugin key
   * spelled `cursor` or `journal` reaches neither of the engine's rows.
   *
   * Asynchronous where the daemon's is not: IndexedDB has no synchronous read.
   */
  async getMeta(key: string): Promise<string | null> {
    const value = await this.metaValue(own(key))
    if (value === null) return null
    if (typeof value !== 'string') throw new EngineError('io', `the stored ${key} is not a string`)
    return value
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    await this.setMetaValue(`cannot record ${key}`, own(key), value)
  }

  /**
   * Buffers everything `fn` writes and commits it in one IDB transaction, or drops it all if
   * `fn` throws. See the class comment for why this cannot be an IDB transaction held open.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const outer = this.overlay
    if (outer) {
      outer.depth++
      try {
        return await fn()
      } finally {
        outer.depth--
      }
    }
    const overlay: Overlay = { entries: new Map(), meta: new Map(), depth: 1 }
    this.overlay = overlay
    let result: T
    try {
      result = await fn()
    } catch (error) {
      // Nothing was written, so there is nothing to roll back.
      this.overlay = null
      throw error
    }
    // Cleared before the flush so its own writes go to the database rather than back into it.
    this.overlay = null
    await this.flush(overlay)
    return result
  }

  /** The overlay, in one readwrite transaction over both stores. */
  private async flush(overlay: Overlay): Promise<void> {
    if (overlay.entries.size === 0 && overlay.meta.size === 0) return
    await this.write('cannot commit the state transaction', [ENTRIES, META], async (tx) => {
      const entries = tx.objectStore(ENTRIES)
      const meta = tx.objectStore(META)
      // Deletes first. One path holds one word in the overlay, so no key is both — but a row
      // that has to go before another can take its `fileId` is the invariant `put` keeps, and
      // this order is what keeps it if an index is ever declared unique.
      for (const [path, entry] of overlay.entries) {
        if (entry === null) await wait(entries.delete(path))
      }
      for (const entry of overlay.entries.values()) {
        if (entry !== null) await wait(entries.put(entry))
      }
      for (const [key, value] of overlay.meta) {
        if (value === null) await wait(meta.delete(key))
        else await wait(meta.put({ key, value } satisfies MetaRow))
      }
    })
  }

  /** A meta value, the overlay first; `null` for a key nothing was written under. */
  private async metaValue(key: string): Promise<unknown> {
    const overlay = this.overlay
    if (overlay?.meta.has(key)) return overlay.meta.get(key)
    const row = await this.read(`cannot read ${key}`, [META], async (tx) =>
      wait<MetaRow | undefined>(tx.objectStore(META).get(key))
    )
    return row === undefined ? null : row.value
  }

  private async setMetaValue(what: string, key: string, value: unknown): Promise<void> {
    const overlay = this.overlay
    if (overlay) {
      overlay.meta.set(key, value)
      return
    }
    await this.write(what, [META], async (tx) => {
      const meta = tx.objectStore(META)
      if (value === null) await wait(meta.delete(key))
      else await wait(meta.put({ key, value } satisfies MetaRow))
    })
  }

  /** A readonly transaction around `fn`. Anything the driver raises comes back as `io`. */
  private async read<T>(
    what: string,
    stores: string[],
    fn: (tx: IDBTransaction) => Promise<T>
  ): Promise<T> {
    const tx = this.begin(what, stores, 'readonly')
    try {
      return await fn(tx)
    } catch (cause) {
      throw asEngineError(what, cause)
    }
  }

  /**
   * A readwrite transaction around `fn`, awaited to completion — so a caller that got no error
   * knows the bytes are the database's problem now, not this process's.
   */
  private async write<T>(
    what: string,
    stores: string[],
    fn: (tx: IDBTransaction) => Promise<T>
  ): Promise<T> {
    const tx = this.begin(what, stores, 'readwrite')
    const done = completion(tx, what)
    let result: T
    try {
      result = await fn(tx)
    } catch (cause) {
      // The abort a failed request already caused must not be reported instead of the request.
      void done.catch((): void => undefined)
      try {
        tx.abort()
      } catch {
        /* already finished */
      }
      throw asEngineError(what, cause)
    }
    await done
    return result
  }

  private begin(what: string, stores: string[], mode: IDBTransactionMode): IDBTransaction {
    try {
      return this.db.transaction(stores, mode)
    } catch (cause) {
      throw asEngineError(what, cause)
    }
  }
}

/** The schema, built on the first open of a database that is not there yet. */
function build(db: IDBDatabase): void {
  const entries = db.createObjectStore(ENTRIES, { keyPath: 'path' })
  // Neither index is declared unique: `put` clears the clash itself, in the same transaction,
  // and a unique index would turn that clearing into a constraint error to work around.
  entries.createIndex(BY_FILE_ID, 'fileId')
  entries.createIndex(BY_WIRE_PATH, 'wirePath')
  db.createObjectStore(META, { keyPath: 'key' })
}

/** The paths of the rows that hold this entry's `fileId` or its `wirePath`. */
async function clashingKeys(entries: IDBObjectStore, entry: StateEntry): Promise<string[]> {
  const byFileId = await wait<IDBValidKey[]>(entries.index(BY_FILE_ID).getAllKeys(entry.fileId))
  const byWirePath = await wait<IDBValidKey[]>(
    entries.index(BY_WIRE_PATH).getAllKeys(entry.wirePath)
  )
  return [...byFileId, ...byWirePath] as string[]
}

const clashes = (a: StateEntry, b: StateEntry): boolean =>
  a.fileId === b.fileId || a.wirePath === b.wirePath

/**
 * One request as a promise.
 *
 * Awaiting it does not end the transaction: the continuation runs as a microtask of the
 * request's own success event, which is inside the window the specification keeps the
 * transaction active for. Awaiting anything else — a fetch, a hash — does end it, which is
 * the whole reason `transaction` is an overlay.
 */
function wait<T>(request: IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error ?? new Error('the request failed'))
  })
}

/** Resolves when the transaction has committed, rejects when it aborted or errored. */
function completion(tx: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(new EngineError('io', `${what}: the write was rolled back`, tx.error))
    tx.onerror = () => reject(new EngineError('io', what, tx.error))
  })
}

const asEngineError = (what: string, cause: unknown): EngineError =>
  cause instanceof EngineError ? cause : new EngineError('io', what, cause)

const copyEntry = (entry: StateEntry | null | undefined): StateEntry | null =>
  entry === null || entry === undefined ? null : { ...entry }

/**
 * A journal the caller and the store do not share, `ops` included: the engine appends to an
 * open journal in place, and a shared array would put a write inside a rolled-back transaction.
 */
const copyJournal = (j: Journal | null): Journal | null => (j ? { ...j, ops: [...j.ops] } : null)
