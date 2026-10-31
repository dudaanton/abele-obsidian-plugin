import type { App } from 'obsidian'
import type { LocalStorage } from './ledgerId'
import { completion, wait } from './idbRequests'
import { IndexedRetention } from './retentionIndex'
import {
  hostChanges,
  hostJournalPath,
  hostJournalId,
  joinHostValue,
  mergeHostChange,
  normalizeHostHeader,
  type HostChange,
  type HostRecord,
} from './hostSyncRecords'
import { HostScanCache, type ScanFingerprint } from './hostScanCache'
import {
  DATABASE,
  RECORDS,
  journalKey,
  migrateHostStorage,
  openHostDatabase,
  readGroup,
  recordKey,
} from './hostSyncSchema'

export type { ScanFingerprint } from './hostScanCache'

const prepared = new WeakMap<LocalStorage, HostSyncStorage>()
const parents = new WeakMap<LocalStorage, LocalStorage>()
export const durableHostOf = (local: LocalStorage): HostSyncStorage | undefined => {
  if (local instanceof HostSyncStorage) return local
  const own = prepared.get(local)
  if (own) return own
  const parent = parents.get(local)
  return parent ? durableHostOf(parent) : undefined
}
export const hostStorageOf = (local: LocalStorage): LocalStorage => durableHostOf(local) ?? local
export function linkHostStorage(alias: LocalStorage, local: LocalStorage): void {
  parents.set(alias, local)
}
export function inheritHostStorage<T extends LocalStorage>(alias: T, local: LocalStorage): T {
  linkHostStorage(alias, local)
  return alias
}
export const flushHostStorage = async (local: LocalStorage): Promise<void> => {
  const store = durableHostOf(local)
  await store?.flush()
}

/** IDB authority with a synchronous draft adapter for legacy settings/forms.
 * loadLocalStorage is a draft preview, never an ownership or recovery read.
 * Only explicit record deltas are persisted, with their preconditions checked in IDB.
 */
export class HostSyncStorage implements LocalStorage {
  /** Scan fingerprints and the classification cache; see HostScanCache. */
  private readonly scan: HostScanCache
  /** Exposed for the bounded-memory tests, which read their sizes. */
  private get scanRevisions(): Map<string, number> {
    return this.scan.scanRevisions
  }
  private get scanMutations(): Map<string, number> {
    return this.scan.scanMutations
  }
  scanFingerprintRevision(path: string): number {
    return this.scan.scanFingerprintRevision(path)
  }
  withScanMutation<T>(paths: readonly string[], work: () => Promise<T>): Promise<T> {
    return this.scan.withScanMutation(paths, work)
  }
  readScanFingerprint(path: string): Promise<ScanFingerprint | undefined> {
    return this.scan.readScanFingerprint(path)
  }
  writeScanFingerprint(
    path: string,
    value: ScanFingerprint,
    revision = this.scan.scanFingerprintRevision(path)
  ): Promise<void> {
    return this.scan.writeScanFingerprint(path, value, revision)
  }
  scanInstallation(path: string): ScanFingerprint | undefined {
    return this.scan.scanInstallation(path)
  }
  pendingScanInstallation(path: string): Promise<void> | undefined {
    return this.scan.pendingScanInstallation(path)
  }
  deferScanInstallation(path: string, until: Promise<void>): () => void {
    return this.scan.deferScanInstallation(path, until)
  }
  rememberScanInstallation(path: string, value: ScanFingerprint, revision: number): void {
    this.scan.rememberScanInstallation(path, value, revision)
  }
  forgetScanInstallation(path: string): void {
    this.scan.forgetScanInstallation(path)
  }
  invalidateScanInstallations(paths: readonly string[]): void {
    this.scan.invalidateScanInstallations(paths)
  }
  readInspections(): Promise<unknown[]> {
    return this.scan.readInspections()
  }
  writeInspections(
    entries: readonly { path: string }[],
    retired: readonly string[] = []
  ): Promise<void> {
    return this.scan.writeInspections(entries, retired)
  }
  retentionIndex(root: string): IndexedRetention {
    return new IndexedRetention(this.db, this.namespace, root)
  }
  private readonly values = new Map<string, unknown>()
  private readonly journalHints = new Map<string, Map<string, unknown>>()
  private readonly dirtyHints = new Set<string>()
  private draftVersion = 0
  private channel: BroadcastChannel | undefined
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
  ) {
    this.scan = new HostScanCache(db, namespace)
  }

  static async open(
    factory: IDBFactory,
    namespace: string,
    local: LocalStorage
  ): Promise<HostSyncStorage> {
    if (!namespace) throw new Error('Sync host storage requires a vault identity')
    const db = await openHostDatabase(factory)
    try {
      const result = new HostSyncStorage(db, namespace, local)
      for (const [key, value] of await migrateHostStorage(db, namespace, local))
        result.setView(key, value)
      // Only a compatibility view. On every reopen the committed IDB rows win.
      for (const [key, value] of result.values) local.saveLocalStorage(key, structuredClone(value))
      prepared.set(local, result)
      if (typeof BroadcastChannel !== 'undefined') {
        result.channel = new BroadcastChannel(DATABASE + ':' + namespace)
        result.channel.onmessage = () => result.invalidate()
      }
      return result
    } catch (error) {
      db.close()
      throw error
    }
  }
  loadLocalStorage(key: string): unknown {
    if (journalKey(key) && !this.journalHints.has(key))
      throw new Error('Sync journal preview is unknown; await readValue before reading it')
    this.materializeHint(key)
    if (!this.values.has(key)) return this.local.loadLocalStorage(key)
    const value = this.values.get(key)
    return value === null || typeof value !== 'object' ? value : structuredClone(value)
  }
  /** Schema validation reads the registry synchronously and never changes its source object.
   * The public preview still copies mutable values for every other caller. */
  readRegistryForValidation(key: string): unknown {
    if (!this.values.has(key)) return this.local.loadLocalStorage(key)
    return this.values.get(key)
  }
  saveLocalStorage(key: string, value: unknown): void {
    if (this.closed) throw new Error('Sync host storage is closed')
    if (this.values.has(key)) {
      const knownHint = this.journalHints.has(key)
      this.materializeHint(key)
      this.draftVersion++
      const copy = structuredClone(value)
      this.pending = this.pending.concat(hostChanges(key, this.values.get(key), copy))
      this.setView(key, copy)
      // Keep old readers' preview current; the committed host row remains authoritative.
      if (key === 'abele-sync-external-activation-v1') this.local.saveLocalStorage(key, copy)
      if (journalKey(key) && !knownHint) this.journalHints.delete(key)
    } else this.local.saveLocalStorage(key, value)
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
  private invalidate(clearHints = true): void {
    // Invalidate any outstanding inventory refresh. Submitted drafts remain only
    // for synchronous forms; no record cache survives to authorize a decision.
    this.draftVersion++
    if (clearHints) {
      this.journalHints.clear()
      this.dirtyHints.clear()
    }
  }

  private setView(key: string, value: unknown): void {
    this.values.set(key, value)
    this.dirtyHints.delete(key)
    if (journalKey(key))
      this.journalHints.set(
        key,
        new Map(
          (Array.isArray(value) ? value : []).map((entry) => [
            hostJournalId(entry as { target: string }),
            entry,
          ])
        )
      )
  }
  private materializeHint(key: string): void {
    if (!this.dirtyHints.delete(key)) return
    this.values.set(key, [...this.journalHints.get(key).values()])
  }

  /** Inventory reads are explicit; individual decisions use readRecord below. */
  async readValue(key: string): Promise<unknown> {
    await this.flush()
    const version = this.draftVersion
    const tx = this.db.transaction(RECORDS, 'readonly')
    const rows = await readGroup(tx.objectStore(RECORDS), this.namespace, key)
    const value = joinHostValue(rows)
    if (this.draftVersion === version) {
      this.setView(key, value)
    }
    return structuredClone(value)
  }

  async readRecord(key: string, id: string): Promise<unknown> {
    await this.flush()
    const tx = this.db.transaction(RECORDS, 'readonly')
    const row = await wait<HostRecord | undefined>(
      tx.objectStore(RECORDS).get(recordKey(this.namespace, key, id))
    )
    return row?.value
  }

  async readPath(key: string, path: string): Promise<unknown[]> {
    return this.readIndexed(key, 'path', [path])
  }
  async readTargets(key: string, targets: readonly string[]): Promise<unknown[]> {
    return this.readIndexed(key, 'target', targets)
  }
  private async readIndexed(
    key: string,
    index: string,
    values: readonly string[]
  ): Promise<unknown[]> {
    await this.flush()
    const tx = this.db.transaction(RECORDS, 'readonly')
    const rows = (
      await Promise.all(
        [...new Set(values)].map((value) =>
          wait<HostRecord[]>(
            tx.objectStore(RECORDS).index(index).getAll([this.namespace, key, value])
          )
        )
      )
    ).flat()
    return rows.map((row) => row.value)
  }

  /** Explicit record commands; the compatibility view never supplies their preconditions. */
  changeRecords(changes: HostChange[]): void {
    if (this.closed) throw new Error('Sync host storage is closed')
    this.draftVersion++
    for (const change of changes) {
      const hint = this.journalHints.get(change.key)
      if (!hint) continue // A partial mutation cannot reconstruct an invalidated inventory.
      if (change.after === undefined) hint.delete(change.id)
      else hint.set(change.id, structuredClone(change.after))
      this.dirtyHints.add(change.key)
    }
    this.pending.push(...structuredClone(changes))
  }
  flush(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Sync host storage is closed'))
    if (!this.pending.length) return this.running ?? Promise.resolve()
    const changes = this.pending
    this.pending = []
    const running = this.tail.then(() => this.commit(changes))
    this.running = running
    this.tail = running.catch(() => {})
    const settled = () => {
      if (this.running === running) this.running = undefined
    }
    void running.then(settled, settled)
    return running
  }

  private async commit(changes: HostChange[]): Promise<void> {
    const tx = this.db.transaction(RECORDS, 'readwrite')
    const done = completion(tx, 'cannot commit sync host records')
    void done.catch(() => {})
    const groups = new Map<string, Map<string, HostRecord>>()
    const advancedHeaders = new Set<string>()
    try {
      const store = tx.objectStore(RECORDS)
      // Header.order is the append counter (migration places it after the existing rows).
      // Never enumerate a journal to allocate an order or retire a single record.
      for (const key of new Set(changes.map((change) => change.key))) {
        const header = await wait<HostRecord>(store.get(recordKey(this.namespace, key, '!header')))
        groups.set(key, new Map([['!header', header]]))
      }
      for (const change of changes) {
        const group = groups.get(change.key)
        if (!group) throw new Error('Sync host transaction group is missing')
        const held = group.has(change.id)
          ? group.get(change.id)
          : await wait<HostRecord | undefined>(
              store.get(recordKey(this.namespace, change.key, change.id))
            )
        const prior = held?.value === undefined ? undefined : held
        const value = mergeHostChange(change, prior?.value)
        if (value === undefined) {
          await wait(store.delete(recordKey(this.namespace, change.key, change.id)))
          group.set(change.id, {
            namespace: this.namespace,
            key: change.key,
            id: change.id,
            value: undefined,
            order: prior?.order ?? 0,
          })
        } else {
          const row: HostRecord = {
            keyId: recordKey(this.namespace, change.key, change.id),
            namespace: this.namespace,
            key: change.key,
            id: change.id,
            value,
            path: hostJournalPath(change.key, value),
            target:
              hostJournalPath(change.key, value) === undefined
                ? undefined
                : (value as { target: string }).target,
            order: prior?.order ?? group.get('!header').order + 1,
          }
          await wait(store.put(row))
          group.set(row.id, row)
          if (!prior) {
            const header = { ...group.get('!header'), order: row.order + 1 }
            group.set('!header', header)
            advancedHeaders.add(change.key)
          }
        }
      }
      for (const [key, group] of groups) {
        const live = new Map([...group].filter(([, row]) => row.value !== undefined))
        if (key === 'abele-sync-connections-v2' || key === 'abele-sync-item-connections-v1') {
          const header = live.get('!header')?.value as { value?: { selectedId?: string } }
          const id = 'records:' + header?.value?.selectedId
          if (!group.has(id)) {
            const selected = await wait<HostRecord | undefined>(
              store.get(recordKey(this.namespace, key, id))
            )
            if (selected) live.set(id, selected)
          }
          if (!live.has(id)) {
            const [first] = await readGroup(store, this.namespace, key, (row) =>
              row.id.startsWith('records:')
            )
            if (first) live.set(first.id, first)
          }
          for (const [id, row] of live) if (!group.has(id)) group.set(id, row)
        }
        // The append counter and normalized header commit once with the whole batch.
        const selection =
          normalizeHostHeader(key, live) ??
          (advancedHeaders.has(key) ? group.get('!header') : undefined)
        if (selection) {
          await wait(store.put(selection))
          group.set(selection.id, selection)
        }
        // The synchronous registry repair sequence must land as one host transaction.
        if (key === 'abele-sync-registry-write-v1' && joinHostValue([...live.values()]) != null)
          throw new Error('Unfinished registry update requires retry before host commit')
      }
      await done
      this.invalidate(false)
      this.channel?.postMessage(null)
    } catch (error) {
      try {
        tx.abort()
      } catch {
        /* Already settled. */
      }
      await done.catch(() => {})
      // Invalidate regardless of queued work. No failed draft is rebuilt into authority.
      this.invalidate()
      throw error
    }
  }
  close(): void {
    this.closed = true
    this.channel?.close()
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
