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
import { STATE_PROJECTION_PASS } from './stateProjectionPass'
import {
  initializeDatabaseIdentity,
  StateRecoveryRequired,
  type StateOpenOptions,
} from './idbIdentity'
import { IndexedDbConnection } from './idbConnection'
import { caseKey } from '@abele/sync-sdk/protocol'
import { portableCandidateKey, PORTABLE_CANDIDATES } from './ledgerPathCandidates'
import {
  copyEntry,
  copyJournal,
  newOverlay,
  overlayDelete,
  overlayPut,
  type Overlay,
} from './stateOverlay'

/**
 * Version 3 adds an indexed spelling inventory without duplicating ledger payloads.
 * The upgrade preserves the existing entries, metadata and external-file fence.
 */
const DB_VERSION = 3

const ENTRIES = 'entries'
const META = 'meta'
const BY_FILE_ID = 'byFileId'
const BY_WIRE_PATH = 'byWirePath'
const PATH_CANDIDATES = 'pathCandidates'

/** How long a `delete` waits for a connection that will not close before it gives up. */
const DELETE_BLOCKED_TIMEOUT_MS = 5000

/** The engine's own two rows in `meta`; `getMeta`/`setMeta` cannot reach either. */
const CURSOR_KEY = 'cursor'
const JOURNAL_KEY = 'journal'
const PULL_WRITE = 'pull-write:'

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
  owner?: string
}

class RevisionConflict extends EngineError {
  constructor(owner: string, writer: string) {
    super('conflict', `State changed during transaction; owner=${owner}; writer=${writer}`)
  }
}

/** Durable ledger with private revocable transaction handles and native revision CAS. */
const DEFER_UNCHANGED_SCOPE = Symbol.for('abele.sync.defer-unchanged-scope-v1')

export class IndexedDbStateStore implements StateStore, ExternalStatePort {
  private normalizationCache: Map<string, Promise<string | null>> | null = null
  private normalizationPassDepth = 0
  private entrySnapshot: Promise<StateEntry[]> | null = null
  /** The pass snapshot by path, for lookups of every scanned file. Tied to its snapshot. */
  private entryIndex: {
    snapshot: Promise<StateEntry[]>
    paths: Promise<Map<string, StateEntry>>
  } | null = null
  /** The pull-write intent keys, read once per pass: a ledger walk asks for each file's. */
  private pullWrites: Promise<Set<string>> | null = null

  async [Symbol.for('abele.sync.normalization-pass-v1')]<T>(work: () => Promise<T>): Promise<T> {
    // Overlapping passes never share a snapshot. Only the ordinary single-owner pass caches.
    this.normalizationCache = ++this.normalizationPassDepth === 1 ? new Map() : null
    this.entrySnapshot = null
    this.pullWrites = null
    try {
      return await work()
    } finally {
      this.normalizationPassDepth--
      this.normalizationCache = null
      this.entrySnapshot = null
      this.pullWrites = null
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
  // Bounded evidence of this connection's intervening commits. Unknown/other-connection
  // revisions are never guessed independent: those transactions restart from fresh reads.
  private readonly recentWrites = new Map<
    number,
    { key: string | null; owner: string; entries: boolean }
  >()
  private scanStateRevision = 0
  private scanStateReadRevision: number | undefined

  /** Unchanged scope publication is repaired by the active cycle before its effects. */
  readonly [DEFER_UNCHANGED_SCOPE] = true;
  [Symbol.for('abele.sync.scope-state-revision-v1')](): Promise<number | undefined> {
    return this.localScanStateRevision()
  }

  /** Only committed entry writes retire a local scan. Unknown writers retire it conservatively. */
  async [Symbol.for('abele.sync.local-scan-state-revision-v1')](): Promise<number | undefined> {
    return this.localScanStateRevision()
  }

  private async localScanStateRevision(): Promise<number | undefined> {
    this.assertRecovery()
    const revision = (await this.metaValue('revision')) ?? 0
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) return undefined
    const previous = this.scanStateReadRevision
    this.scanStateReadRevision = revision
    if (previous !== undefined && previous !== revision) {
      let changed = revision < previous || revision - previous > this.recentWrites.size
      if (!changed)
        for (let at = previous + 1; at <= revision; at++) {
          const write = this.recentWrites.get(at)
          if (!write || write.entries) {
            changed = true
            break
          }
        }
      if (changed) this.scanStateRevision++
    }
    return this.scanStateRevision
  }

  /** Status writes follow engine overlays, but are not file-effect overlays themselves.
   * External phases may proceed: they CAS their own document and never consume this projection.
   */
  async [STATE_PROJECTION_PASS]<T>(work: () => Promise<T>): Promise<T> {
    this.assertRecovery()
    const previous = this.committed
    let finish!: () => void
    this.committed = new Promise<void>((resolve) => {
      finish = resolve
    })
    try {
      await previous
      this.assertRecovery()
      return await work()
    } finally {
      finish()
    }
  }
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
    // Inside a pass, a lookup reuses the walk's snapshot; any entry write drops that snapshot.
    const snapshot = this.entrySnapshot
    if (this.normalizationCache && !this.transactionPending && snapshot !== null) {
      if (this.entryIndex?.snapshot !== snapshot)
        this.entryIndex = {
          snapshot,
          paths: snapshot.then(async (rows) => {
            const paths = new Map<string, StateEntry>()
            const budget = new SyncTaskBudget()
            for (const row of rows) {
              paths.set(row.path, row)
              await budget.account(4096)
            }
            return paths
          }),
        }
      const index = this.entryIndex.paths
      const rows = await index.catch((): null => null)
      if (rows && this.entrySnapshot === snapshot) return copyEntry(rows.get(path))
    }
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

  /** A feed page asks for its identities together, never one native transaction per lookup. */
  async [Symbol.for('abele.sync.feed-entries-v1')](
    ids: readonly string[],
    signal?: AbortSignal
  ): Promise<StateEntry[]> {
    this.assertRecovery()
    const result: StateEntry[] = []
    const budget = new SyncTaskBudget()
    for (let offset = 0; offset < ids.length; offset += 512) {
      signal?.throwIfAborted()
      const rows = await this.read('cannot read feed ledger entries', [ENTRIES], async (tx) => {
        const index = tx.objectStore(ENTRIES).index(BY_FILE_ID)
        return Promise.all(
          ids.slice(offset, offset + 512).map((id) => wait<StateEntry | undefined>(index.get(id)))
        )
      })
      for (const row of rows) if (row) result.push({ ...row })
      await budget.account(8192, signal)
    }
    return result
  }

  /** Read only the current feed page's ordering proofs; retain no cross-page snapshot. */
  async [Symbol.for('abele.sync.feed-metadata-v1')](
    keys: readonly string[],
    signal?: AbortSignal
  ): Promise<Map<string, string | null>> {
    return this.feedMetadata(keys, signal)
  }
  private async feedMetadata(
    keys: readonly string[],
    signal?: AbortSignal
  ): Promise<Map<string, string | null>> {
    this.assertRecovery()
    const result = new Map<string, string | null>()
    const budget = new SyncTaskBudget()
    for (let offset = 0; offset < keys.length; offset += 1024) {
      signal?.throwIfAborted()
      const names = keys.slice(offset, offset + 1024)
      const rows = await this.read('cannot read feed metadata', [META], async (tx) =>
        Promise.all(
          names.map((name) => wait<MetaRow | undefined>(tx.objectStore(META).get(own(name))))
        )
      )
      for (const [i, row] of rows.entries()) {
        if (row && typeof row.value !== 'string')
          throw new EngineError('io', 'Invalid feed metadata')
        result.set(names[i], row ? (row.value as string) : null)
      }
      await budget.account(8192, signal)
    }
    return result
  }

  async *pathCandidates(
    path: string,
    key: (path: string) => string = caseKey
  ): AsyncIterable<StateEntry> {
    this.assertRecovery()
    // Unknown/custom equivalence relations retain the conservative complete walk.
    if (key !== caseKey && Reflect.get(key, PORTABLE_CANDIDATES) !== true) {
      const wanted = key(path)
      for await (const entry of this.all()) if (key(entry.path) === wanted) yield entry
      return
    }
    const rows = await this.read(
      'cannot read path candidates',
      [ENTRIES, PATH_CANDIDATES],
      async (tx) => {
        const paths = await wait<{ path: string }[]>(
          tx.objectStore(PATH_CANDIDATES).index('bucket').getAll(portableCandidateKey(path))
        )
        return Promise.all(
          paths.map((item) => wait<StateEntry | undefined>(tx.objectStore(ENTRIES).get(item.path)))
        )
      }
    )
    const wanted = key(path)
    for (const entry of rows) if (entry && key(entry.path) === wanted) yield { ...entry }
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
        if (path !== copy.path) await deleteEntry(tx, path)
      }
      await putEntry(tx, copy)
    })
    await this.committedEntryObserver?.([copy])
  }

  async delete(path: string): Promise<void> {
    this.assertRecovery()
    await this.write(`cannot forget ${path}`, [ENTRIES], async (tx) => deleteEntry(tx, path))
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
    // Inside a pass, an absent pull-write intent is answered from one key inventory instead of
    // one transaction per file. Any write in this store drops the inventory.
    if (key.startsWith(PULL_WRITE) && this.normalizationCache && !this.transactionPending) {
      const inventory = (this.pullWrites ??= this.metadataKeys(PULL_WRITE).then(
        (keys) => new Set(keys)
      ))
      const known = await inventory.catch((error) => {
        if (this.pullWrites === inventory) this.pullWrites = null
        throw error
      })
      if (!known.has(key)) return null
    }
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
    return this.readMetadata(
      '',
      false,
      () => new Map<string, string>(),
      (result, key, value) => {
        if (typeof value !== 'string') throw new EngineError('io', 'Invalid plugin metadata')
        result.set(key, value)
      }
    )
  }

  /**
   * Plugin metadata keys under `prefix`, as `getMeta` spells them, the open transaction's writes
   * included. The core retires every durable download intent after a server restore through it.
   */
  async metadataKeys(prefix: string): Promise<string[]> {
    this.assertRecovery()
    return this.readMetadata(
      prefix,
      true,
      () => [] as string[],
      (keys, key) => keys.push(key)
    )
  }

  /** One readonly prefix snapshot for startup's linked metadata inventories.
   * No cache survives the caller's pass; unrelated receipts are never materialized.
   */
  async [Symbol.for('abele.sync.metadata-prefix-v1')](
    prefix: string
  ): Promise<Map<string, string>> {
    this.assertRecovery()
    return this.readMetadata(
      prefix,
      false,
      () => new Map<string, string>(),
      (rows, key, value) => {
        if (typeof value !== 'string') throw new EngineError('io', 'Invalid plugin metadata')
        rows.set(key, value)
      }
    )
  }

  /** Each bounded page is its own host task; never materialize the entire store in onsuccess.
   * Keep one readonly snapshot, including when lifecycle retirement races another writer.
   * Seek directly to the plugin prefix without reading unrelated payloads.
   */
  private async readMetadata<T>(
    prefix: string,
    keysOnly: boolean,
    create: () => T,
    visit: (result: T, key: string, value: unknown) => void
  ): Promise<T> {
    const scoped = own(prefix)
    return this.read(
      'cannot inventory plugin metadata',
      [META],
      async (tx) =>
        new Promise<T>((resolve, reject) => {
          // A recovered connection restarts with a fresh accumulator, never a partial inventory.
          const result = create()
          const store = tx.objectStore(META)
          if (typeof IDBKeyRange !== 'undefined') {
            let lower = scoped,
              exclusive = false
            const page = () => {
              // A lower bound alone also clones the next unrelated page, which can hold
              // large recovery documents even when this prefix has no rows at all.
              let upper = scoped
              while (upper.endsWith('\uffff')) upper = upper.slice(0, -1)
              upper =
                upper.slice(0, -1) + String.fromCharCode(upper.charCodeAt(upper.length - 1) + 1)
              const range = IDBKeyRange.bound(lower, upper, exclusive, true)
              const request = keysOnly ? store.getAllKeys(range, 256) : store.getAll(range, 256)
              request.onerror = () => reject(request.error)
              request.onsuccess = () => {
                try {
                  const rows = request.result as (IDBValidKey | MetaRow)[]
                  let last: string | undefined
                  for (const row of rows) {
                    const key = keysOnly ? row : (row as MetaRow).key
                    if (typeof key !== 'string' || !key.startsWith(scoped)) return resolve(result)
                    visit(result, key.slice(7), keysOnly ? undefined : (row as MetaRow).value)
                    last = key
                  }
                  if (rows.length < 256 || last === undefined) return resolve(result)
                  lower = last
                  exclusive = true
                  page()
                } catch (error) {
                  reject(asEngineError('cannot inventory plugin metadata', error))
                }
              }
            }
            page()
            return
          }
          // Non-browser consumers can supply only an IDBFactory. Keep cursor semantics there.
          const request = keysOnly ? store.openKeyCursor() : store.openCursor()
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            try {
              const cursor = request.result
              if (!cursor) return resolve(result)
              const key = cursor.key
              if (typeof key !== 'string') {
                cursor.continue()
                return
              }
              if (key < scoped) {
                cursor.continue(scoped)
                return
              }
              if (!key.startsWith(scoped)) return resolve(result)
              visit(
                result,
                key.slice(7),
                keysOnly ? undefined : (cursor as IDBCursorWithValue).value.value
              )
              cursor.continue()
            } catch (error) {
              reject(asEngineError('cannot inventory plugin metadata', error))
            }
          }
        })
    )
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
    this.pullWrites = null
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
      tx = this.begin('cannot commit external phase', [ENTRIES, META, PATH_CANDIDATES], 'readwrite')
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
      for (const path of ledger.deletePaths ?? []) await deleteEntry(tx, path)
      for (const entry of ledger.putEntries ?? []) {
        for (const path of await clashingKeys(entries, entry, true, true))
          if (path !== entry.path) await deleteEntry(tx, path)
        await putEntry(tx, entry)
      }
      if (ledger.cursor !== undefined)
        await wait(meta.put({ key: CURSOR_KEY, value: ledger.cursor }))
      for (const item of ledger.metadata ?? []) {
        if (item.value === null) await wait(meta.delete(own(item.key)))
        else await wait(meta.put({ key: own(item.key), value: item.value }))
      }
      await wait(meta.put({ key: own(EXTERNAL_STATE_KEY), value: batch.next }))
      await bumpRevision(tx, new Error('external file phase').stack ?? 'external file phase')
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
      this.pullWrites = null
    }
  }

  readonly transactionScoped = true

  async transaction<T>(fn: (tx: StateStore) => Promise<T>): Promise<T> {
    this.assertRecovery()
    if (this.externalPhasePending) throw new ExternalStateError('nested-transaction')
    const owner = new Error('state transaction').stack ?? 'state transaction'
    const previous = this.committed
    let finish!: () => void
    this.committed = new Promise<void>((resolve) => {
      finish = resolve
    })
    this.transactionPending++
    try {
      await previous
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.runScoped(fn, owner)
        } catch (error) {
          if (!(error instanceof RevisionConflict) || attempt === 2) throw error
          console.debug('[abele-sync] retrying state transaction', error.message)
        }
      }
    } finally {
      this.transactionPending--
      finish()
    }
  }

  private async runScoped<T>(fn: (tx: StateStore) => Promise<T>, owner: string): Promise<T> {
    const revision = (await this.metaValue('revision')) ?? 0
    const reads = new Set<string>()
    const prefixes = new Set<string>()
    const prefetched = new Map<string, string | null>()
    const parent = new Proxy(this, {
      get: (target, key) => {
        if (key === 'getMeta')
          return (name: string) => {
            reads.add(own(name))
            if (prefetched.has(name)) return Promise.resolve(prefetched.get(name))
            return target.getMeta(name)
          }
        if (key === 'metadataKeys')
          return (prefix: string) => {
            prefixes.add(own(prefix))
            return target.metadataKeys(prefix)
          }
        const value: unknown = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const scoped = new StateTransaction(parent, async (entry) => {
      const paths = await this.clashesInDatabase(
        'cannot check transaction indexes',
        entry,
        true,
        true
      )
      const rows = await Promise.all(paths.map((path) => this.get(path)))
      return rows.filter((row): row is StateEntry => row !== null)
    })
    let prefetchOpen = true
    Object.defineProperty(scoped, Symbol.for('abele.sync.feed-metadata-v1'), {
      configurable: true,
      value: async (keys: readonly string[], signal?: AbortSignal) => {
        if (!prefetchOpen) throw new EngineError('conflict', 'state transaction handle has expired')
        const rows = await this.feedMetadata(keys, signal)
        if (!prefetchOpen) throw new EngineError('conflict', 'state transaction handle has expired')
        // These are ordinary transaction reads: an overlapping writer forces a fresh retry.
        for (const [key, value] of rows) {
          reads.add(own(key))
          prefetched.set(key, value)
        }
        return rows
      },
    })
    // Keep acknowledgements separate so caller handles expire before any flush awaits.
    const acknowledgements = new StateTransaction(this)
    try {
      const result = await fn(scoped)
      scoped.acknowledgeThrough(acknowledgements)
      prefetchOpen = false
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
      await this.flush(overlay, revision, reads, prefixes, owner)
      acknowledgements.acknowledgeCommit()
      await this.committedEntryObserver?.(
        [...overlay.entries.values()].filter((entry): entry is StateEntry => entry !== null)
      )
      return result
    } finally {
      prefetchOpen = false
      scoped.close()
      acknowledgements.close()
      this.normalizationCache?.clear()
    }
  }

  /** The overlay, in one readwrite transaction over both stores. */
  private async flush(
    overlay: Overlay,
    revision: unknown,
    reads: Set<string>,
    prefixes: Set<string>,
    owner: string
  ): Promise<void> {
    await this.write(
      'cannot commit the state transaction',
      [ENTRIES, META],
      async (tx) => {
        const meta = tx.objectStore(META)
        const current = await wait<MetaRow | undefined>(meta.get('revision'))
        const latest = current?.value ?? 0
        if (latest !== revision) {
          let independent =
            typeof revision === 'number' &&
            typeof latest === 'number' &&
            latest > revision &&
            latest - revision <= this.recentWrites.size
          if (independent) {
            for (let at = Number(revision) + 1; at <= Number(latest); at++) {
              const write = this.recentWrites.get(at)
              if (
                !write?.key ||
                reads.has(write.key) ||
                overlay.meta.has(write.key) ||
                [...prefixes].some((prefix) => write.key?.startsWith(prefix))
              ) {
                independent = false
                break
              }
            }
          }
          if (!independent) {
            throw new RevisionConflict(owner, current?.owner ?? 'unknown connection')
          }
          // Only disjoint plugin metadata changed. Apply the original overlay to the current
          // database, preserving acknowledged receipts without replaying any file effects.
        }
        // Deletes first. One path holds one word in the overlay, so no key is both — but a row
        // that has to go before another can take its `fileId` is the invariant `put` keeps, and
        // this order is what keeps it if an index is ever declared unique.
        for (const [path, entry] of overlay.entries) {
          if (entry === null) await deleteEntry(tx, path)
        }
        for (const entry of overlay.entries.values()) {
          if (entry !== null) await putEntry(tx, entry)
        }
        for (const [key, value] of overlay.meta) {
          if (value === null) await wait(meta.delete(key))
          else await wait(meta.put({ key, value } satisfies MetaRow))
        }
      },
      null,
      overlay.entries.size > 0
    )
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
      await this.write(
        what,
        [META],
        async (tx) => {
          const meta = tx.objectStore(META)
          if (value === null) await wait(meta.delete(key))
          else await wait(meta.put({ key, value } satisfies MetaRow))
        },
        key.startsWith('plugin:') ? key : null
      )
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
    fn: (tx: IDBTransaction) => Promise<T>,
    metadataKey: string | null = null,
    entriesChanged = stores.includes(ENTRIES)
  ): Promise<T> {
    const owner = new Error(what).stack ?? what
    if (stores.includes(ENTRIES)) this.entrySnapshot = null
    this.pullWrites = null
    return this.once(what, async () => {
      const tx = this.begin(
        what,
        [...new Set([...stores, META, ...(stores.includes(ENTRIES) ? [PATH_CANDIDATES] : [])])],
        'readwrite'
      )
      const done = completion(tx, what)
      let result: T
      let revision: number
      try {
        result = await fn(tx)
        revision = await bumpRevision(tx, owner)
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
      this.recentWrites.set(revision, { key: metadataKey, owner, entries: entriesChanged })
      if (this.recentWrites.size > 128)
        this.recentWrites.delete(this.recentWrites.keys().next().value)
      return result
    }).finally(() => {
      if (stores.includes(ENTRIES)) this.entrySnapshot = null
      // An inventory read while this write was queued may predate its commit.
      this.pullWrites = null
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
  if (!db.objectStoreNames.contains(PATH_CANDIDATES)) {
    const paths = db.createObjectStore(PATH_CANDIDATES, { keyPath: 'path' })
    paths.createIndex('bucket', 'bucket')
    const cursor = paths.transaction.objectStore(ENTRIES).openCursor()
    cursor.onsuccess = () => {
      const current = cursor.result
      if (!current) return
      const path = (current.value as StateEntry).path
      paths.put({ path, bucket: portableCandidateKey(path) })
      current.continue()
    }
  }
}

async function putEntry(tx: IDBTransaction, entry: StateEntry): Promise<void> {
  await wait(tx.objectStore(ENTRIES).put(entry))
  await wait(
    tx
      .objectStore(PATH_CANDIDATES)
      .put({ path: entry.path, bucket: portableCandidateKey(entry.path) })
  )
}
async function deleteEntry(tx: IDBTransaction, path: string): Promise<void> {
  await wait(tx.objectStore(ENTRIES).delete(path))
  await wait(tx.objectStore(PATH_CANDIDATES).delete(path))
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

async function bumpRevision(tx: IDBTransaction, owner: string): Promise<number> {
  const meta = tx.objectStore(META)
  const row = await wait<MetaRow | undefined>(meta.get('revision'))
  const revision = Number(row?.value ?? 0) + 1
  await wait(meta.put({ key: 'revision', value: revision, owner } satisfies MetaRow))
  return revision
}
