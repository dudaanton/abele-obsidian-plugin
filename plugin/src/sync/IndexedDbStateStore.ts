import {
  EngineError,
  StateTransaction,
  checkExternalPhase,
  prepareExternalLedger,
  EXTERNAL_STATE_KEY,
  ExternalStateError,
  type ExternalPhaseBatch,
  type ExternalStatePort,
  type Journal,
  type StateEntry,
  type StateStore,
} from '@abele/sync-sdk/core'
import { asEngineError, completion, connectTo, deleteDatabase, wait } from './idbRequests'
import { SyncTaskBudget } from './syncTaskBudget'
import {
  initializeDatabaseIdentity,
  StateRecoveryRequired,
  type StateOpenOptions,
} from './idbIdentity'
import { IndexedDbConnection } from './idbConnection'
import {
  copyEntry,
  copyJournal,
  newOverlay,
  overlayDelete,
  overlayPut,
  type Overlay,
} from './stateOverlay'

/**
 * Version 2 fences the version-1 client before external-file activation. The migration
 * preserves existing stores, entries and metadata; it is not a new empty ledger.
 */
const DB_VERSION = 2

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

/** Durable ledger with private revocable transaction handles and native revision CAS. */
export class IndexedDbStateStore implements StateStore, ExternalStatePort {
  private normalizationCache: Map<string, Promise<string | null>> | null = null
  private normalizationPassDepth = 0
  private entrySnapshot: Promise<StateEntry[]> | null = null

  async [Symbol.for('abele.sync.normalization-pass-v1')]<T>(work: () => Promise<T>): Promise<T> {
    // Overlapping passes never share a snapshot. Only the ordinary single-owner pass caches.
    this.normalizationCache = ++this.normalizationPassDepth === 1 ? new Map() : null
    this.entrySnapshot = null
    try {
      return await work()
    } finally {
      this.normalizationPassDepth--
      this.normalizationCache = null
      this.entrySnapshot = null
    }
  }
  readonly externalDurability = 'durable' as const
  private transactionPending = 0
  private externalPhasePending = false
  private externalCommitUnknown = false
  private assertEffect: (() => void) | null = null
  /** Runtime ownership is checked at actual transaction creation, including after awaits. */
  guardEffects(assertEffect: () => void): void {
    this.assertEffect = assertEffect
  }
  private entryObserver: ((entry: StateEntry) => Promise<void>) | null = null
  private committedEntryObserver: ((entries: StateEntry[]) => Promise<void>) | null = null

  /** Host evidence may retire only after IDB COMMIT, never at overlay put time. */
  observeCommittedEntries(observer: (entries: StateEntry[]) => Promise<void>): void {
    this.committedEntryObserver = observer
  }

  /** Startup retirement must not mistake an open SDK overlay for a committed ledger. */
  async readCommittedEntries(paths: readonly string[]): Promise<StateEntry[]> {
    this.assertRecovery()
    return this.read('cannot read committed write acknowledgements', [ENTRIES], async (tx) => {
      const entries = tx.objectStore(ENTRIES)
      const rows = await Promise.all(
        paths.map((path) => wait<StateEntry | undefined>(entries.get(path)))
      )
      return rows.filter((row): row is StateEntry => row !== undefined)
    })
  }

  /** Independent durable provenance must settle before an identity can be filed/adopted. */
  observeEntries(observer: (entry: StateEntry) => Promise<void>): void {
    this.entryObserver = observer
  }

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
  get databaseVersion(): number {
    return this.connection.db.version
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

  private constructor(
    private readonly connection: IndexedDbConnection,
    readonly databaseIdentity: string
  ) {
    connection.onRecoveryRequired = (error) => {
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
        (db) => {
          options.effectGuard?.()
          build(db)
        },
        (db) => {
          // A `delete` or a version bump from another window must not hang on this connection.
          console.debug(`[abele-sync] closing the state database ${name}: another window wants it`)
          db.close()
          if (store?.db === db) {
            store.connection.close()
            store.closedElsewhere?.()
          }
        },
        DB_VERSION
      )
    options.effectGuard?.()
    const db = await connect()
    try {
      const identity = await initializeDatabaseIdentity(db, options.effectGuard)
      const checks = [
        identity,
        ...(options.identity
          ? [{ key: own(options.identity.key), value: options.identity.value }]
          : []),
      ]
      store = new IndexedDbStateStore(new IndexedDbConnection(db, connect, checks), identity.value)
      if (options.effectGuard) store.guardEffects(options.effectGuard)
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
    return this.read(`cannot read the state of ${path}`, [ENTRIES], async (tx) =>
      copyEntry(await wait<StateEntry | undefined>(tx.objectStore(ENTRIES).get(path)))
    )
  }

  async byFileId(fileId: string): Promise<StateEntry | null> {
    this.assertRecovery()
    const rows = await this.read(`cannot read the state of ${fileId}`, [ENTRIES], async (tx) =>
      wait<StateEntry[]>(tx.objectStore(ENTRIES).index(BY_FILE_ID).getAll(fileId))
    )
    return copyEntry(rows[0])
  }

  async *all(): AsyncIterable<StateEntry> {
    this.assertRecovery()
    // Every row up front: the caller may await between steps, and an IDB cursor held across an
    // await sees its transaction commit out from under the walk.
    const read = () =>
      this.read('cannot read the state', [ENTRIES], async (tx) =>
        wait<StateEntry[]>(tx.objectStore(ENTRIES).getAll())
      )
    const rows = await (this.normalizationCache
      ? (this.entrySnapshot ??= read().catch((error) => {
          this.entrySnapshot = null
          throw error
        }))
      : read())
    const budget = new SyncTaskBudget()
    for (const row of rows) {
      await budget.account(4096)
      yield { ...row }
    }
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
    await this.write(what, [ENTRIES], async (tx) => {
      const entries = tx.objectStore(ENTRIES)
      for (const path of await clashingKeys(entries, copy, true, true)) {
        if (path !== copy.path) await wait(entries.delete(path))
      }
      await wait(entries.put(copy))
    })
    await this.committedEntryObserver?.([copy])
  }

  async delete(path: string): Promise<void> {
    this.assertRecovery()
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
    const cache =
      !this.transactionPending &&
      (key === 'normalization-collisions' || key === 'normalization-directory-collisions')
        ? this.normalizationCache
        : null
    const previous = cache?.get(key)
    if (previous !== undefined) return previous
    const loading = this.readMeta(key)
    cache?.set(key, loading)
    try {
      return await loading
    } catch (error) {
      if (cache?.get(key) === loading) cache.delete(key)
      throw error
    }
  }

  private async readMeta(key: string): Promise<string | null> {
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

  /**
   * Plugin metadata keys under `prefix`, as `getMeta` spells them, the open transaction's writes
   * included. The core retires every durable download intent after a server restore through it.
   */
  async metadataKeys(prefix: string): Promise<string[]> {
    this.assertRecovery()
    const stored = await this.read('cannot list plugin metadata', [META], async (tx) =>
      wait<IDBValidKey[]>(tx.objectStore(META).getAllKeys())
    )
    const keys = new Set(stored.filter((key): key is string => typeof key === 'string'))
    const scoped = own(prefix)
    return [...keys].filter((key) => key.startsWith(scoped)).map((key) => key.slice(7))
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    this.assertRecovery()
    await this.setMetaValue(`cannot record ${key}`, own(key), value)
  }

  private assertExternalBoundary(): void {
    this.assertRecovery()
    if (!this.permitsEngineEffects || this.externalCommitUnknown)
      throw new ExternalStateError('recovery-required')
    if (this.transactionPending || this.externalPhasePending)
      throw new ExternalStateError('nested-transaction')
  }

  /** Read committed external state only: an ordinary overlay is never a durable phase. */
  async getExternalState(): Promise<string | null> {
    this.assertRecovery()
    if (this.transactionPending || this.externalPhasePending)
      throw new ExternalStateError('nested-transaction')
    return this.getMeta(EXTERNAL_STATE_KEY)
  }

  /** Data-only CAS over the existing ledger stores. Never joins an overlay or retries a write. */
  async commitExternalPhase(batch: ExternalPhaseBatch): Promise<void> {
    this.assertExternalBoundary()
    this.entrySnapshot = null
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
      await bumpRevision(tx)
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
      this.entrySnapshot = null
    }
  }

  readonly transactionScoped = true

  async transaction<T>(fn: (tx: StateStore) => Promise<T>): Promise<T> {
    this.assertRecovery()
    if (this.externalPhasePending) throw new ExternalStateError('nested-transaction')
    const previous = this.committed
    let finish!: () => void
    this.committed = new Promise<void>((resolve) => {
      finish = resolve
    })
    this.transactionPending++
    try {
      await previous
      return await this.runScoped(fn)
    } finally {
      this.transactionPending--
      finish()
    }
  }

  private async runScoped<T>(fn: (tx: StateStore) => Promise<T>): Promise<T> {
    const revision = (await this.metaValue('revision')) ?? 0
    const scoped = new StateTransaction(this, async (entry) => {
      const paths = await this.clashesInDatabase(
        'cannot check transaction indexes',
        entry,
        true,
        true
      )
      const rows = await Promise.all(paths.map((path) => this.get(path)))
      return rows.filter((row): row is StateEntry => row !== null)
    })
    // Keep acknowledgements separate so caller handles expire before any flush awaits.
    const acknowledgements = new StateTransaction(this)
    try {
      const result = await fn(scoped)
      scoped.acknowledgeThrough(acknowledgements)
      scoped.close()
      const overlay = newOverlay()
      for (const mutation of scoped.mutations) {
        switch (mutation.kind) {
          case 'put':
            await this.entryObserver?.({ ...mutation.entry })
            overlayPut(overlay, mutation.entry)
            break
          case 'delete':
            overlayDelete(overlay, mutation.path)
            break
          case 'cursor':
            overlay.meta.set(CURSOR_KEY, mutation.value)
            break
          case 'journal':
            overlay.meta.set(JOURNAL_KEY, copyJournal(mutation.value))
            break
          case 'meta':
            overlay.meta.set(own(mutation.key), mutation.value)
            break
        }
      }
      await this.flush(overlay, revision)
      acknowledgements.acknowledgeCommit()
      await this.committedEntryObserver?.(
        [...overlay.entries.values()].filter((entry): entry is StateEntry => entry !== null)
      )
      return result
    } finally {
      scoped.close()
      acknowledgements.close()
      this.normalizationCache?.clear()
    }
  }

  /** The overlay, in one readwrite transaction over both stores. */
  private async flush(overlay: Overlay, revision: unknown): Promise<void> {
    await this.write('cannot commit the state transaction', [ENTRIES, META], async (tx) => {
      const entries = tx.objectStore(ENTRIES)
      const meta = tx.objectStore(META)
      const current = await wait<MetaRow | undefined>(meta.get('revision'))
      if ((current?.value ?? 0) !== revision)
        throw new EngineError('conflict', 'State changed during transaction')
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
    const row = await this.read(`cannot read ${key}`, [META], async (tx) =>
      wait<MetaRow | undefined>(tx.objectStore(META).get(key))
    )
    return row === undefined ? null : row.value
  }

  private async setMetaValue(what: string, key: string, value: unknown): Promise<void> {
    this.normalizationCache?.delete(key.slice('plugin:'.length))
    try {
      await this.write(what, [META], async (tx) => {
        const meta = tx.objectStore(META)
        if (value === null) await wait(meta.delete(key))
        else await wait(meta.put({ key, value } satisfies MetaRow))
      })
    } finally {
      this.normalizationCache?.delete(key.slice('plugin:'.length))
    }
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
    if (stores.includes(ENTRIES)) this.entrySnapshot = null
    return this.once(what, async () => {
      const tx = this.begin(what, [...new Set([...stores, META])], 'readwrite')
      const done = completion(tx, what)
      let result: T
      try {
        result = await fn(tx)
        await bumpRevision(tx)
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
    }).finally(() => {
      if (stores.includes(ENTRIES)) this.entrySnapshot = null
    })
  }

  private once<T>(what: string, attempt: () => Promise<T>): Promise<T> {
    return this.connection.once(what, attempt)
  }
  private begin(what: string, stores: string[], mode: IDBTransactionMode): IDBTransaction {
    if (mode === 'readwrite') this.assertEffect?.()
    return this.connection.begin(what, stores, mode)
  }
}

/** The schema, built on the first open of a database that is not there yet. */
function build(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(ENTRIES)) {
    const entries = db.createObjectStore(ENTRIES, { keyPath: 'path' })
    // Neither index is unique; put clears clashes in the same transaction.
    entries.createIndex(BY_FILE_ID, 'fileId')
    entries.createIndex(BY_WIRE_PATH, 'wirePath')
  }
  if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
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

async function bumpRevision(tx: IDBTransaction): Promise<void> {
  const meta = tx.objectStore(META)
  const row = await wait<MetaRow | undefined>(meta.get('revision'))
  await wait(meta.put({ key: 'revision', value: Number(row?.value ?? 0) + 1 }))
}
