import type { FileInfo, FileSystem } from '@abele/sync-sdk/core'
import { SyncTaskBudget, waitForSyncRead } from './syncTaskBudget'

export const SCAN_HASH_READY = Symbol.for('abele.sync.scan-hash-ready-v1')

/** Bound discovery of new local content while retaining the complete file-name inventory.
 * Tracked files and explicit watcher paths are never deferred by the core scanner. */
export class ProgressiveLocalScan {
  private readonly admitted = new Set<string>()
  private readonly deferred = new Set<string>()
  private pass = {}
  private started = performance.now()
  private readingSince?: number
  private foregroundSince?: number
  private milliseconds?: number
  private signal?: AbortSignal
  private readonly completed = new Map<string, FileInfo>()
  private readonly failed = new Set<string>()
  private queue: FileInfo[] = []
  private next = 0
  private workers: Promise<void>[] = []
  private running = 0
  private failure?: unknown
  private task = new SyncTaskBudget()
  constructor(
    private readonly limit:
      | number
      | {
          milliseconds: number
          concurrency: number
          foregroundMilliseconds?: number
          canRead?: () => boolean
          claimRead?: () => boolean
        } = 32
  ) {}
  begin(signal?: AbortSignal, milliseconds?: number): void {
    if (this.running) throw new Error('Previous content reads are still settling')
    this.admitted.clear()
    this.deferred.clear()
    this.pass = {}
    this.started = performance.now()
    this.readingSince = undefined
    this.foregroundSince = undefined
    this.signal = signal
    this.milliseconds = milliseconds
    this.completed.clear()
    // A failed prefetch was already deferred by the scanner. Keep its handoff
    // across passes so the next ordinary read records the file error/backoff.
    this.failure = undefined
    this.queue = []
    this.next = 0
    this.workers = []
    this.task = new SyncTaskBudget()
  }
  get elapsedMs(): number {
    return Math.round(performance.now() - this.started)
  }
  async finish(): Promise<void> {
    await Promise.all(this.workers)
    this.signal?.throwIfAborted()
    if (this.failure) throw this.failure
  }
  private prefetch(fs: FileSystem, info: FileInfo): void {
    const options = this.limit
    if (
      typeof options === 'number' ||
      options.canRead?.() === false ||
      this.admitted.has(info.path)
    )
      return
    const milliseconds = this.milliseconds ?? options.milliseconds
    this.readingSince ??= performance.now()
    if (performance.now() - this.readingSince >= milliseconds) return
    this.admitted.add(info.path)
    this.queue.push(info)
    if (this.running >= options.concurrency) return
    this.running++
    const work = async () => {
      try {
        while (
          this.next < this.queue.length &&
          options.canRead?.() !== false &&
          performance.now() - this.readingSince! < milliseconds
        ) {
          this.signal?.throwIfAborted()
          const candidate = this.queue[this.next++]
          try {
            const result = await waitForSyncRead(
              fs.fingerprint!(candidate.path, this.signal),
              this.signal
            )
            if (result.size === candidate.size && result.mtime === candidate.mtime)
              this.completed.set(candidate.path, candidate)
          } catch {
            // Let the scanner's ordinary per-file retry/review path inspect failures.
            this.failed.add(candidate.path)
          }
          const pause = this.task.metadataRow(this.signal)
          if (pause) await pause
        }
      } finally {
        this.running--
      }
    }
    // Keep every issued read owned by the scan, including cancellation/failure.
    this.workers.push(
      work().catch((error) => {
        if (!this.signal?.aborted) this.failure ??= error
      })
    )
  }
  get pending(): boolean {
    return this.deferred.size > 0
  }
  get deferredCount(): number {
    return this.deferred.size
  }
  private async *inventory(fs: FileSystem): AsyncIterable<FileInfo> {
    const absent = new Set(this.failed)
    for await (const info of fs.list()) {
      absent.delete(info.path)
      yield info
    }
    // Early return, listing failure or cancellation cannot prove absence.
    this.signal?.throwIfAborted()
    for (const path of absent) {
      this.failed.delete(path)
      const pause = this.task.metadataRow(this.signal)
      if (pause) await pause
    }
  }
  fileSystem(fs: FileSystem): FileSystem {
    return new Proxy(fs, {
      get: (target, name) => {
        if (name === 'list' && this.failed.size) return () => this.inventory(target)
        if (name === 'fingerprint' && target.fingerprint)
          return async (...args: Parameters<NonNullable<FileSystem['fingerprint']>>) => {
            const result = await target.fingerprint!(...args)
            this.failed.delete(args[0])
            return result
          }
        if (name === 'deferNewLocalFile')
          return async (info: FileInfo) => {
            const ready = Reflect.get(target, SCAN_HASH_READY)
            if (!target.trustedIndexIdentities || typeof ready !== 'function') return false
            const known = await ready.call(target, info, this.pass)
            if (known === true) this.failed.delete(info.path)
            const completed = this.completed.get(info.path)
            if (
              known === true ||
              (completed &&
                completed.size === info.size &&
                completed.mtime === info.mtime &&
                completed.ctime === info.ctime)
            ) {
              this.deferred.delete(info.path)
              return false
            }
            // Hosts without durable resumable evidence retain the ordinary full scan.
            if (known === undefined) return false
            if (typeof this.limit !== 'number' && this.limit.canRead?.() === false) {
              if (this.limit.claimRead?.()) {
                this.deferred.delete(info.path)
                return false
              }
              this.deferred.add(info.path)
              return true
            }
            if (this.failed.has(info.path)) {
              this.deferred.delete(info.path)
              return false
            }
            if (typeof this.limit !== 'number' && target.fingerprint && info.size <= 256 * 1024) {
              // Small edits must reach this exchange even when their watcher event
              // has not arrived yet. Spend a short time window in the ordinary
              // scanner before moving the remaining cold inventory to workers.
              this.foregroundSince ??= performance.now()
              if (
                performance.now() - this.foregroundSince <
                (this.limit.foregroundMilliseconds ?? 0)
              )
                return false
              this.prefetch(target, info)
              this.deferred.add(info.path)
              return true
            }
            if (this.admitted.has(info.path)) return false
            if (this.admitted.size < (typeof this.limit === 'number' ? this.limit : 32)) {
              this.admitted.add(info.path)
              return false
            }
            this.deferred.add(info.path)
            return true
          }
        if (name === Symbol.for('abele.sync.finish-scan-uploads-v1'))
          return async () => {
            await this.finish()
            await Reflect.get(target, name)?.call(target)
          }
        const value = Reflect.get(target, name)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
}
