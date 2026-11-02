import { completion, wait } from './idbRequests'
import { STORE } from './hostSyncSchema'
import { readIdbSnapshot } from './idbSnapshot'
import { SyncTaskBudget } from './syncTaskBudget'

const INSPECTION = '!inspection-v1:'
export interface ScanFingerprint {
  identity: string
  size: number
  mtime: number
  ctime: number
  sha: string
  /** Native content-change clock, distinct from stable object identity. */
  contentRevision?: string
  /** Verified transfer publication, never an ordinary scan hint. */
  installation?: true
}

/** Per-path scan fingerprints and the projection classification cache, kept in the host
 * database beside the sync records. Mutations fence both until their invalidation commits. */
export class HostScanCache {
  readonly scanRevisions = new Map<string, number>()
  readonly scanMutations = new Map<string, number>()
  /** Only scopes whose invalidation has reached IDB COMMIT may cover another writer. */
  private readonly scanInvalidations = new Map<string, number>()
  private scanGeneration = 0
  private scanRevisionFloor = 0
  /** Unexamined installation proofs span the pull's watcher backlog. Every writer retires
   * affected proofs directly, so eviction of the bounded revision clock cannot invalidate
   * unrelated installations or revive a changed one. Shared across filesystem instances. */
  private readonly installations = new Map<string, ScanFingerprint>()
  private readonly installing = new Map<string, Promise<void>>()
  private inspectionWrites: Promise<void> = Promise.resolve()
  pendingScanInstallation(path: string): Promise<void> | undefined {
    return this.installing.get(path)
  }
  deferScanInstallation(path: string, until: Promise<void>): () => void {
    this.installing.set(path, until)
    return () => {
      if (this.installing.get(path) === until) this.installing.delete(path)
    }
  }
  private readonly installationParents = new Set<string>()
  scanInstallation(path: string): ScanFingerprint | undefined {
    return this.scanMutationActive(path) ? undefined : this.installations.get(path)
  }
  rememberScanInstallation(path: string, value: ScanFingerprint, revision: number): void {
    if (this.scanMutationActive(path) || revision !== this.scanFingerprintRevision(path)) return
    this.installations.set(path, value)
    for (let end = path.lastIndexOf('/'); end > 0; end = path.lastIndexOf('/', end - 1))
      this.installationParents.add(path.slice(0, end))
  }
  forgetScanInstallation(path: string): void {
    this.installations.delete(path)
    if (!this.installations.size) this.installationParents.clear()
  }
  invalidateScanInstallations(paths: readonly string[]): void {
    for (const path of paths) {
      this.installations.delete(path)
      if (this.installationParents.has(path))
        for (const key of this.installations.keys())
          if (key.startsWith(path + '/')) this.installations.delete(key)
    }
    if (!this.installations.size) this.installationParents.clear()
  }
  constructor(
    private readonly db: IDBDatabase,
    private readonly namespace: string
  ) {}
  private reviseScan(path: string): void {
    if (!this.scanRevisions.has(path) && this.scanRevisions.size >= 4096) {
      this.scanRevisions.clear()
      // Eviction invalidates every older captured generation, including paths
      // whose explicit revision was zero. It cannot revive stale write-back.
      this.scanRevisionFloor = ++this.scanGeneration
    }
    this.scanRevisions.set(path, ++this.scanGeneration)
  }
  scanFingerprintRevision(path: string): number {
    let revision = this.scanRevisionFloor
    for (let key = path; key; key = key.slice(0, Math.max(0, key.lastIndexOf('/'))))
      revision = Math.max(revision, this.scanRevisions.get(key) ?? 0)
    return revision
  }
  private scanMutationActive(path: string, scopes = this.scanMutations): boolean {
    for (let key = path; key; key = key.slice(0, Math.max(0, key.lastIndexOf('/'))))
      if (scopes.has(key)) return true
    return false
  }
  async withScanMutation<T>(paths: readonly string[], work: () => Promise<T>): Promise<T> {
    const keys = [...new Set(paths)]
    this.invalidateScanInstallations(keys)
    const invalidated = keys.every((key) => this.scanMutationActive(key, this.scanInvalidations))
    for (const key of keys) {
      this.reviseScan(key)
      this.scanMutations.set(key, (this.scanMutations.get(key) ?? 0) + 1)
    }
    let committed = false
    try {
      // Pending mutations fence caches, but cannot prove durable invalidation.
      // Only an already committed covering scope lets this writer skip its own barrier.
      if (!invalidated) {
        const tx = this.db.transaction(STORE, 'readwrite')
        const done = completion(tx, 'invalidate scan fingerprints')
        for (const key of keys) {
          tx.objectStore(STORE).delete([this.namespace, '!scan-fingerprint-v1:' + key])
          // Seek just this subtree; directory moves never enumerate unrelated records.
          const prefix = '!scan-fingerprint-v1:' + key + '/'
          if (typeof IDBKeyRange !== 'undefined') {
            tx.objectStore(STORE).delete(
              IDBKeyRange.bound(
                [this.namespace, prefix],
                [this.namespace, '!scan-fingerprint-v1:' + key + '0'],
                false,
                true
              )
            )
            continue
          }
          const request = tx.objectStore(STORE).openKeyCursor()
          request.onsuccess = () => {
            const cursor = request.result
            if (!cursor) return
            const [namespace, name] = cursor.key as [string, string]
            if (namespace < this.namespace || (namespace === this.namespace && name < prefix)) {
              cursor.continue([this.namespace, prefix])
              return
            }
            if (namespace !== this.namespace || !name.startsWith(prefix)) return
            tx.objectStore(STORE).delete(cursor.primaryKey)
            cursor.continue()
          }
        }
        await done
      }
      // Count each lifetime even when it reuses a covering cohort: nested work may outlive it.
      for (const key of keys)
        this.scanInvalidations.set(key, (this.scanInvalidations.get(key) ?? 0) + 1)
      committed = true
      return await work()
    } finally {
      this.invalidateScanInstallations(keys)
      for (const key of keys) {
        if (committed) {
          const remaining = (this.scanInvalidations.get(key) ?? 1) - 1
          if (remaining) this.scanInvalidations.set(key, remaining)
          else this.scanInvalidations.delete(key)
        }
        this.reviseScan(key)
        const remaining = (this.scanMutations.get(key) ?? 1) - 1
        if (remaining) this.scanMutations.set(key, remaining)
        else this.scanMutations.delete(key)
      }
    }
  }
  async readScanFingerprint(path: string): Promise<ScanFingerprint | undefined> {
    const tx = this.db.transaction(STORE, 'readonly')
    const done = completion(tx, 'read scan fingerprint')
    const row = await wait<{ value: ScanFingerprint } | undefined>(
      tx.objectStore(STORE).get([this.namespace, '!scan-fingerprint-v1:' + path])
    )
    await done
    return this.scanMutationActive(path) ? undefined : row?.value
  }
  async writeScanFingerprint(
    path: string,
    value: ScanFingerprint,
    revision = this.scanFingerprintRevision(path)
  ): Promise<void> {
    await this.writeScanFingerprints([{ path, value, revision }])
  }
  async writeScanFingerprints(
    rows: readonly { path: string; value: ScanFingerprint; revision: number }[]
  ): Promise<void> {
    if (
      !rows.some(
        (row) =>
          !this.scanMutationActive(row.path) &&
          row.revision === this.scanFingerprintRevision(row.path)
      )
    )
      return
    const tx = this.db.transaction(STORE, 'readwrite')
    const done = completion(tx, 'write scan fingerprints')
    this.putScanFingerprints(tx, rows)
    await done
  }
  /** Enqueue coherent receipts into an existing host journal transaction. */
  putScanFingerprints(
    tx: IDBTransaction,
    rows: readonly { path: string; value: ScanFingerprint; revision: number }[]
  ): void {
    for (const { path, value, revision } of rows) {
      if (this.scanMutationActive(path) || revision !== this.scanFingerprintRevision(path)) continue
      tx.objectStore(STORE).put({
        namespace: this.namespace,
        key: '!scan-fingerprint-v1:' + path,
        value,
      })
    }
  }
  /** The projection classification cache, one row per physical path. It grows with the vault,
   * so it lives here rather than in the host's small local-storage quota. */
  async readInspections(): Promise<unknown[]> {
    const tx = this.db.transaction(STORE, 'readonly')
    const done = completion(tx, 'read inspection cache')
    // Bounded ranged requests where the host has key ranges; a seeking cursor otherwise.
    if (typeof IDBKeyRange !== 'undefined') {
      const range = IDBKeyRange.bound(
        [this.namespace, INSPECTION],
        [this.namespace, '!inspection-v1;'],
        false,
        true
      )
      const rows = await readIdbSnapshot<{ namespace: string; key: string; value: unknown }>(
        tx.objectStore(STORE),
        (row) => [row.namespace, row.key],
        range
      )
      await done
      return rows.map((row) => row.value)
    }
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const values: unknown[] = []
      const request = tx.objectStore(STORE).openCursor()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return resolve(values)
        const [namespace, name] = cursor.key as [string, string]
        if (namespace < this.namespace || (namespace === this.namespace && name < INSPECTION)) {
          cursor.continue([this.namespace, INSPECTION])
          return
        }
        if (namespace !== this.namespace || !name.startsWith(INSPECTION)) return resolve(values)
        values.push((cursor.value as { value: unknown }).value)
        cursor.continue()
      }
    })
    await done
    return rows
  }
  async writeInspections(
    entries: readonly { path: string }[],
    retired: readonly string[] = []
  ): Promise<void> {
    if (!entries.length && !retired.length) return
    const pendingEntries = [...entries]
    const pendingRetired = [...retired]
    const write = this.inspectionWrites.then(async () => {
      const budget = new SyncTaskBudget()
      let removed = 0
      let saved = 0
      while (removed < pendingRetired.length || saved < pendingEntries.length) {
        const tx = this.db.transaction(STORE, 'readwrite')
        const done = completion(tx, 'write inspection cache')
        const store = tx.objectStore(STORE)
        let count = 0
        while (count < 256 && removed < pendingRetired.length) {
          store.delete([this.namespace, INSPECTION + pendingRetired[removed++]])
          count++
        }
        while (count < 256 && saved < pendingEntries.length) {
          const entry = pendingEntries[saved++]
          store.put({ namespace: this.namespace, key: INSPECTION + entry.path, value: entry })
          count++
        }
        await done
        await budget.account(count * 512)
      }
    })
    // Preserve call order across the short transactions, including after a failed save.
    this.inspectionWrites = write.catch(() => {})
    return write
  }
}
