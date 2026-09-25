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

/** How long a `delete` waits for a connection that will not close before it gives up. */
const DELETE_BLOCKED_TIMEOUT_MS = 5000

/** The engine's own two rows in `meta`; `getMeta`/`setMeta` cannot reach either. */
const CURSOR_KEY = 'cursor'
const JOURNAL_KEY = 'journal'

/** A plugin key, kept clear of the engine's two: `plugin:<key>`, as the daemon writes `daemon:`. */
const own = (key: string): string => `plugin:${key}`

/**
 * The database one device's ledger lives in. One local vault, one database, one name.
 *
 * Named after the `stateId` the plugin mints when it enrols, not after the server's vault id:
 * Obsidian's IndexedDB belongs to the app rather than to the vault, so two local vaults syncing
 * the same server vault would otherwise share one ledger. The id is kept in the vault's local
 * storage and in no file, for the same reason (`ledgerId.ts`).
 */
export const stateDatabaseName = (stateId: string): string => `abele-sync-${stateId}`

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
 *
 * `byFileId` and `byWirePath` index the live entries the way the database's own indexes do, so
 * a batch of a thousand puts costs a thousand map lookups rather than a thousand scans of
 * everything written so far, and so `put` can tell which keys the overlay can already answer
 * for without asking the database.
 */
interface Overlay {
  entries: Map<string, StateEntry | null>
  /** fileId → the path the overlay currently holds it under. Live entries only. */
  byFileId: Map<string, string>
  /** wirePath → the path the overlay currently holds it under. Live entries only. */
  byWirePath: Map<string, string>
  meta: Map<string, unknown>
  /** Rejects if the transaction is rolled back, so a joined call fails with it. Never resolves. */
  discarded: Promise<never>
  /** Rejects `discarded`. */
  discard: (error: unknown) => void
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
 * ## One transaction at a time
 *
 * Top-level transactions are serialised: each waits for the previous one to finish
 * **committing**, not merely to finish running, so no write can slip between an overlay and
 * the flush that lands it, and two of them land in the order they were started.
 *
 * A call that arrives while a body is still running is treated as nested and joins it. A
 * WebView offers no way to tell such a call apart from a second, independent caller — there is
 * no `AsyncLocalStorage`, and a call made after an `await` inside `fn` looks exactly like one
 * made from another task. Joining is the safe half of that guess: writes are never lost, they
 * land with the outer transaction, and reads see them. What a joined caller does not get is a
 * transaction of its own, so if the outer one rolls back its writes go with it — which is why
 * a joined call that is still running when the outer fails is rejected with the outer's error
 * rather than resolving as though it had committed. The engine has exactly one `transaction`
 * call site and never runs two syncs at once; a host that wants two independent transactions
 * has to await the first.
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
  /** Non-null exactly while a transaction's body is running; a call arriving then joins it. */
  private overlay: Overlay | null = null
  /**
   * The tail of the queue of top-level transactions: resolved once the last one has committed
   * (or failed). A new top-level transaction chains itself onto it before opening its overlay.
   */
  private committed: Promise<void> = Promise.resolve()

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
   * Forgets a vault entirely. Every connection to the database must be closed first: the delete
   * is blocked by the ones that are not, and a blocked delete never finishes on its own — so it
   * is given `blockedTimeoutMs` to be let through and then reported as an `io` rather than left
   * as a promise the caller waits on for the rest of the session.
   */
  static delete(
    indexedDB: IDBFactory,
    name: string,
    blockedTimeoutMs = DELETE_BLOCKED_TIMEOUT_MS
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = indexedDB.deleteDatabase(name)
      } catch (cause) {
        reject(new EngineError('io', `cannot forget the state database ${name}`, cause))
        return
      }
      let timer: number | null = null
      const settle = (finish: () => void): void => {
        if (timer !== null) window.clearTimeout(timer)
        timer = null
        finish()
      }
      request.onblocked = () => {
        console.debug(`[abele-sync] waiting to forget ${name}: it is still open somewhere`)
        // A connection that ignores `versionchange` — another window running an older build —
        // holds this open for ever otherwise.
        timer = window.setTimeout(() => {
          reject(new EngineError('io', `cannot forget ${name}: the state database is still open`))
        }, blockedTimeoutMs)
      }
      request.onerror = () =>
        settle(() =>
          reject(new EngineError('io', `cannot forget the state database ${name}`, request.error))
        )
      request.onsuccess = () => settle(resolve)
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
      const path = overlay.byFileId.get(fileId)
      if (path !== undefined) return copyEntry(overlay.entries.get(path))
    }
    const rows = await this.read(`cannot read the state of ${fileId}`, [ENTRIES], async (tx) =>
      wait<StateEntry[]>(tx.objectStore(ENTRIES).index(BY_FILE_ID).getAll(fileId))
    )
    // A row the overlay holds a newer word on was either deleted or rewritten under another
    // fileId; the index above already answered for the rewrite that still holds this one.
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
    const what = `cannot record ${copy.path}`
    const overlay = this.overlay
    if (overlay) {
      const byFileId = overlay.byFileId.get(copy.fileId)
      const byWirePath = overlay.byWirePath.get(copy.wirePath)
      if (byFileId !== undefined && byFileId !== copy.path) overlayDelete(overlay, byFileId)
      if (byWirePath !== undefined && byWirePath !== copy.path) overlayDelete(overlay, byWirePath)
      // The database is only asked about a key the overlay cannot answer for: whichever put
      // first filed that key here already cleared every row of the database holding it.
      for (const path of await this.clashesInDatabase(
        what,
        copy,
        byFileId === undefined,
        byWirePath === undefined
      )) {
        // A path the overlay has already written is authoritative, and the clash the database
        // reports for it is stale — this very transaction is about to rewrite or remove that
        // row. Nulling it here is what used to lose a rename that swapped two names over.
        if (path !== copy.path && !overlay.entries.has(path)) overlayDelete(overlay, path)
      }
      overlayPut(overlay, copy)
      return
    }
    await this.write(what, [ENTRIES], async (tx) => {
      const entries = tx.objectStore(ENTRIES)
      for (const path of await clashingKeys(entries, copy, true, true)) {
        if (path !== copy.path) await wait(entries.delete(path))
      }
      await wait(entries.put(copy))
    })
  }

  async delete(path: string): Promise<void> {
    if (this.overlay) {
      overlayDelete(this.overlay, path)
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
   * `fn` throws. See the class comment for why this cannot be an IDB transaction held open,
   * and for what joins an open transaction rather than starting one of its own.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const outer = this.overlay
    if (outer) {
      // Part of the transaction that is already open: no overlay, no commit of its own. The
      // race is what stops a joined call from reporting success for writes a rollback took.
      return await Promise.race([fn(), outer.discarded])
    }
    // Queued behind whatever was started before this call, and holding the next one back until
    // this one has committed. Both halves are set up synchronously, so the queue is in call
    // order however long each transaction takes.
    const previous = this.committed
    let finished = (): void => undefined
    this.committed = new Promise<void>((resolve) => (finished = resolve))
    try {
      await previous
      return await this.run(fn)
    } finally {
      finished()
    }
  }

  /** One top-level transaction: an overlay, the body, and one flush. */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    const overlay = newOverlay()
    this.overlay = overlay
    let result: T
    try {
      result = await fn()
    } catch (error) {
      // Nothing was written, so there is nothing to roll back — but a call that joined this
      // one and is still running must not be told its writes landed.
      this.overlay = null
      overlay.discard(error)
      throw error
    }
    // Cleared before the flush so its own writes go to the database rather than back into it.
    this.overlay = null
    try {
      await this.flush(overlay)
    } catch (error) {
      // A flush that fails is a rollback like any other — it lands whole or not at all — so a
      // joined call still running hears about it exactly as it would a body that threw.
      overlay.discard(error)
      throw error
    }
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

  /** The paths of the rows the database holds under this entry's keys, for the keys asked about. */
  private async clashesInDatabase(
    what: string,
    entry: StateEntry,
    byFileId: boolean,
    byWirePath: boolean
  ): Promise<string[]> {
    if (!byFileId && !byWirePath) return []
    return this.read(what, [ENTRIES], async (tx) =>
      clashingKeys(tx.objectStore(ENTRIES), entry, byFileId, byWirePath)
    )
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

/** The paths of the rows that hold this entry's `fileId` or its `wirePath`, as asked for. */
async function clashingKeys(
  entries: IDBObjectStore,
  entry: StateEntry,
  byFileId: boolean,
  byWirePath: boolean
): Promise<string[]> {
  const found: IDBValidKey[] = []
  if (byFileId) {
    found.push(...(await wait<IDBValidKey[]>(entries.index(BY_FILE_ID).getAllKeys(entry.fileId))))
  }
  if (byWirePath) {
    found.push(
      ...(await wait<IDBValidKey[]>(entries.index(BY_WIRE_PATH).getAllKeys(entry.wirePath)))
    )
  }
  return found as string[]
}

const newOverlay = (): Overlay => {
  let discard = (_error: unknown): void => undefined
  const discarded = new Promise<never>((_, reject) => (discard = reject))
  // Nothing joins most transactions, and a rejection nobody awaits is an unhandled one.
  void discarded.catch((): void => undefined)
  return {
    entries: new Map(),
    byFileId: new Map(),
    byWirePath: new Map(),
    meta: new Map(),
    discarded,
    discard,
  }
}

/** Writes an entry into the overlay and files it under both of its keys. */
function overlayPut(overlay: Overlay, entry: StateEntry): void {
  overlayForget(overlay, entry.path)
  overlay.entries.set(entry.path, entry)
  overlay.byFileId.set(entry.fileId, entry.path)
  overlay.byWirePath.set(entry.wirePath, entry.path)
}

/** Marks a path deleted in the overlay, whatever the database still holds under it. */
function overlayDelete(overlay: Overlay, path: string): void {
  overlayForget(overlay, path)
  overlay.entries.set(path, null)
}

/** Drops the index entries of whatever the overlay currently holds under `path`. */
function overlayForget(overlay: Overlay, path: string): void {
  const held = overlay.entries.get(path)
  if (!held) return
  if (overlay.byFileId.get(held.fileId) === path) overlay.byFileId.delete(held.fileId)
  if (overlay.byWirePath.get(held.wirePath) === path) overlay.byWirePath.delete(held.wirePath)
}

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
