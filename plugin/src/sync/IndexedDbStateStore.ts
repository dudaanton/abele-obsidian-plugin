import { EngineError, type Journal, type StateEntry, type StateStore } from '@abele/sync-core'
import { asEngineError, completion, connectTo, deleteDatabase, wait } from './idbRequests'
import {
  initializeDatabaseIdentity,
  StateRecoveryRequired,
  type StateOpenOptions,
} from './idbIdentity'
import { IndexedDbConnection } from './idbConnection'
import {
  checkExternalPhase,
  prepareExternalLedger,
  EXTERNAL_STATE_KEY,
  ExternalStateError,
  type ExternalPhaseBatch,
  type ExternalStatePort,
} from './external/state'
import {
  copyEntry,
  copyJournal,
  newOverlay,
  overlayDelete,
  overlayPut,
  type Overlay,
} from './stateOverlay'

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
 * that evicted the origin's storage, and all of those are `io`. The one failure tried again is
 * WebKit dropping a transaction, which gets one more go on a fresh connection (`once`).
 */
export class IndexedDbStateStore implements StateStore, ExternalStatePort {
  readonly externalDurability = 'durable' as const
  private transactionPending = 0
  private externalPhasePending = false
  private externalCommitUnknown = false
  private entryObserver: ((entry: StateEntry) => Promise<void>) | null = null

  /** Independent durable provenance must settle before an identity can be filed/adopted. */
  observeEntries(observer: (entry: StateEntry) => Promise<void>): void {
    this.entryObserver = observer
  }

  /** Non-null exactly while a transaction's body is running; a call arriving then joins it. */
  private overlay: Overlay | null = null
  /**
   * The tail of the queue of top-level transactions: resolved once the last one has committed
   * (or failed). A new top-level transaction chains itself onto it before opening its overlay.
   */
  private committed: Promise<void> = Promise.resolve()
  /** Told when another window made this connection close: see `onClosedElsewhere`. */
  private closedElsewhere: (() => void) | null = null

  private recoveryRequired: ((error: StateRecoveryRequired) => void) | null = null
  onRecoveryRequired(callback: (error: StateRecoveryRequired) => void): void {
    this.recoveryRequired = callback
  }
  get permitsEngineEffects(): boolean {
    return this.connection.permitsEffects
  }
  private assertRecovery(): void {
    this.connection.assertRecovery()
  }
  private get db(): IDBDatabase {
    return this.connection.db
  }

  private constructor(private readonly connection: IndexedDbConnection) {
    connection.onRecoveryRequired = (error) => {
      this.overlay?.discard(error)
      this.recoveryRequired?.(error)
    }
  }

  /**
   * Called once if another window deletes or upgrades this database and the connection closes
   * under whoever holds it. Every call after that fails, so the holder has to stop — not go on
   * failing transaction by transaction in IndexedDB's own words. A `close()` of ours does not
   * call it.
   */
  onClosedElsewhere(cb: () => void): void {
    this.closedElsewhere = cb
  }

  /**
   * Opens (and creates) the database and its stores. The factory is passed in rather than
   * taken from the window so a test can hand over its own and two tests never share one.
   */
  static async open(
    indexedDB: IDBFactory,
    name: string,
    options: StateOpenOptions = {}
  ): Promise<IndexedDbStateStore> {
    let store: IndexedDbStateStore | null = null
    const connect = (): Promise<IDBDatabase> =>
      connectTo(
        indexedDB,
        name,
        build,
        (db) => {
          // A `delete` or a version bump from another window must not hang on this connection.
          console.debug(`[abele-sync] closing the state database ${name}: another window wants it`)
          db.close()
          if (store?.db === db) store.closedElsewhere?.()
        },
        DB_VERSION
      )
    const db = await connect()
    try {
      const identity = await initializeDatabaseIdentity(db)
      const checks = [
        identity,
        ...(options.identity
          ? [{ key: own(options.identity.key), value: options.identity.value }]
          : []),
      ]
      store = new IndexedDbStateStore(new IndexedDbConnection(db, connect, checks))
      return store
    } catch (error) {
      db.close()
      throw error
    }
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
    return deleteDatabase(indexedDB, name, blockedTimeoutMs)
  }

  close(): void {
    this.connection.close()
  }

  async get(path: string): Promise<StateEntry | null> {
    this.assertRecovery()
    const overlaid = this.overlay?.entries.get(path)
    if (overlaid !== undefined) return copyEntry(overlaid)
    return this.read(`cannot read the state of ${path}`, [ENTRIES], async (tx) =>
      copyEntry(await wait<StateEntry | undefined>(tx.objectStore(ENTRIES).get(path)))
    )
  }

  async byFileId(fileId: string): Promise<StateEntry | null> {
    this.assertRecovery()
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
    this.assertRecovery()
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
    this.assertRecovery()
    await this.entryObserver?.({ ...entry })
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
    this.assertRecovery()
    if (this.overlay) {
      overlayDelete(this.overlay, path)
      return
    }
    await this.write(`cannot forget ${path}`, [ENTRIES], async (tx) =>
      wait(tx.objectStore(ENTRIES).delete(path))
    )
  }

  async getCursor(): Promise<number> {
    this.assertRecovery()
    const value = await this.metaValue(CURSOR_KEY)
    if (value === null) return 0
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EngineError('io', 'the stored cursor is not a number')
    }
    return value
  }

  async setCursor(seq: number): Promise<void> {
    this.assertRecovery()
    await this.setMetaValue('cannot record the cursor', CURSOR_KEY, seq)
  }

  async getJournal(): Promise<Journal | null> {
    this.assertRecovery()
    const value = await this.metaValue(JOURNAL_KEY)
    if (value === null) return null
    if (typeof value !== 'object')
      throw new EngineError('io', 'the stored journal is not an object')
    // A copy either way: out of the database it is already a clone, out of the overlay it is
    // the object the engine handed over, and the engine appends to an open journal in place.
    return copyJournal(value as Journal)
  }

  async setJournal(j: Journal | null): Promise<void> {
    this.assertRecovery()
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
    this.assertRecovery()
    const value = await this.metaValue(own(key))
    if (value === null) return null
    if (typeof value !== 'string') throw new EngineError('io', `the stored ${key} is not a string`)
    return value
  }

  /** Durable plugin metadata inventory for conservative lifecycle retirement, never engine rows. */
  async pluginMeta(): Promise<Map<string, string>> {
    this.assertRecovery()
    const rows = await this.read('cannot inventory plugin metadata', [META], async (tx) =>
      wait<MetaRow[]>(tx.objectStore(META).getAll())
    )
    const result = new Map<string, string>()
    for (const row of rows) {
      if (!row.key.startsWith('plugin:')) continue
      if (typeof row.value !== 'string') throw new EngineError('io', 'Invalid plugin metadata')
      result.set(row.key.slice(7), row.value)
    }
    return result
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    this.assertRecovery()
    await this.setMetaValue(`cannot record ${key}`, own(key), value)
  }

  private assertExternalBoundary(): void {
    this.assertRecovery()
    if (!this.permitsEngineEffects || this.externalCommitUnknown)
      throw new ExternalStateError('recovery-required')
    if (this.overlay || this.transactionPending || this.externalPhasePending)
      throw new ExternalStateError('nested-transaction')
  }

  /** Read committed external state only: an ordinary overlay is never a durable phase. */
  async getExternalState(): Promise<string | null> {
    this.assertRecovery()
    if (this.overlay || this.transactionPending || this.externalPhasePending)
      throw new ExternalStateError('nested-transaction')
    return this.getMeta(EXTERNAL_STATE_KEY)
  }

  /** Data-only CAS over the existing ledger stores. Never joins an overlay or retries a write. */
  async commitExternalPhase(batch: ExternalPhaseBatch): Promise<void> {
    this.assertExternalBoundary()
    batch = structuredClone(batch)
    this.externalPhasePending = true
    let tx: IDBTransaction
    try {
      const ledger = prepareExternalLedger(batch.ledger)
      // Existing independent publication provenance must settle before filing identities.
      // This may await another store, so it belongs BEFORE the data-only phase transaction.
      for (const entry of ledger.putEntries ?? []) await this.entryObserver?.({ ...entry })
      this.assertRecovery()
      if (!this.permitsEngineEffects) throw new ExternalStateError('recovery-required')
      tx = this.begin('cannot commit external phase', [ENTRIES, META], 'readwrite')
    } catch (cause) {
      this.externalPhasePending = false
      throw new ExternalStateError('aborted', { cause })
    }
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(new ExternalStateError('aborted', { cause: tx.error }))
      // Requests reject below; an error event is not COMMIT or ABORT acknowledgement.
      tx.onerror = (): void => undefined
    })
    void done.catch((): void => undefined)
    try {
      const meta = tx.objectStore(META)
      const row = await wait<MetaRow | undefined>(meta.get(own(EXTERNAL_STATE_KEY)))
      if (row && typeof row.value !== 'string') throw new ExternalStateError('recovery-required')
      const { ledger } = checkExternalPhase(batch, row ? (row.value as string) : null)
      const entries = tx.objectStore(ENTRIES)
      for (const path of ledger.deletePaths ?? []) await wait(entries.delete(path))
      for (const entry of ledger.putEntries ?? []) {
        for (const path of await clashingKeys(entries, entry, true, true))
          if (path !== entry.path) await wait(entries.delete(path))
        await wait(entries.put(entry))
      }
      if (ledger.cursor !== undefined)
        await wait(meta.put({ key: CURSOR_KEY, value: ledger.cursor }))
      for (const item of ledger.metadata ?? []) {
        if (item.value === null) await wait(meta.delete(own(item.key)))
        else await wait(meta.put({ key: own(item.key), value: item.value }))
      }
      await wait(meta.put({ key: own(EXTERNAL_STATE_KEY), value: batch.next }))
      await done
      if (!this.permitsEngineEffects) throw new ExternalStateError('commit-unknown')
    } catch (cause) {
      try {
        tx.abort()
      } catch {
        /* May already have committed: resolve below, never retry. */
      }
      let aborted = false
      try {
        await done
      } catch (error) {
        aborted = error instanceof ExternalStateError && error.reason === 'aborted'
      }
      if (!aborted) {
        this.externalCommitUnknown = true
        throw new ExternalStateError('commit-unknown', { cause })
      }
      if (cause instanceof ExternalStateError) throw cause
      throw new ExternalStateError('aborted', { cause })
    } finally {
      this.externalPhasePending = false
    }
  }

  /**
   * Buffers everything `fn` writes and commits it in one IDB transaction, or drops it all if
   * `fn` throws. See the class comment for why this cannot be an IDB transaction held open,
   * and for what joins an open transaction rather than starting one of its own.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.assertRecovery()
    if (this.externalPhasePending) throw new ExternalStateError('nested-transaction')
    const outer = this.overlay
    if (outer) {
      // Part of the transaction that is already open: no overlay, no commit of its own. The
      // race is what stops a joined call from reporting success for writes a rollback took.
      return await Promise.race([fn(), outer.discarded])
    }
    // Queued behind whatever was started before this call, and holding the next one back until
    // this one has committed. Both halves are set up synchronously, so the queue is in call
    // order however long each transaction takes.
    this.transactionPending++
    const previous = this.committed
    let finished = (): void => undefined
    this.committed = new Promise<void>((resolve) => (finished = resolve))
    try {
      await previous
      return await this.run(fn)
    } finally {
      this.transactionPending--
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
    return this.once(what, async () => {
      const tx = this.begin(what, stores, 'readonly')
      try {
        return await fn(tx)
      } catch (cause) {
        throw asEngineError(what, cause)
      }
    })
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
    return this.once(what, async () => {
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
    })
  }

  private once<T>(what: string, attempt: () => Promise<T>): Promise<T> {
    return this.connection.once(what, attempt)
  }
  private begin(what: string, stores: string[], mode: IDBTransactionMode): IDBTransaction {
    return this.connection.begin(what, stores, mode)
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
