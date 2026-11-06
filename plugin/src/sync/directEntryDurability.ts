import { yieldSyncTask } from './syncTaskBudget'
import { EngineError } from '@abele/sync-sdk/core'
const SHARED = Symbol.for('abele.sync.direct-entry-durability-v1')
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
interface DirectoryNode {
  children: Map<string, DirectoryNode>
}
interface FlushWaiter {
  flush: (directory: string) => Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

/** Evidence about our own namespace mutations, never about content or external writers. */
export class DirectEntryDurability {
  /** The adapter outlives a plugin reload. Keep its older directory facts and ports. */
  static adopt(state: DirectEntryDurability): DirectEntryDurability {
    if (typeof state.settled === 'function') return state
    // An earlier plugin owns these promises. Never replace their state or claim
    // that it is drained; the reload teardown must finish before adoption.
    if (state.flushing.size)
      throw Object.assign(
        new EngineError(
          'offline',
          'Previous directory durability work is still finishing. Try again.'
        ),
        { retryable: true }
      )
    const fresh = new DirectEntryDurability()
    Object.assign(state, { activeFlushes: 0, failed: fresh.failed, stops: fresh.stops })
    Object.setPrototypeOf(state, DirectEntryDurability.prototype)
    return state
  }
  private activeFlushes = 0
  private readonly failed = new Map<string, Error>()
  private readonly stops = new Set<{ resolve(): void; reject(error: unknown): void }>()
  private readonly dirty = new Map<string, number>()
  private generation = 0
  private readonly flushing = new Map<string, FlushWaiter[]>()
  private readonly directories: DirectoryNode = { children: new Map() }
  rememberDirectory(path: string): void {
    let node = this.directories
    for (const part of path.split('/').filter(Boolean)) {
      let child = node.children.get(part)
      if (!child) node.children.set(part, (child = { children: new Map() }))
      node = child
    }
  }
  directoryKnown(path: string): boolean {
    let node = this.directories
    for (const part of path.split('/').filter(Boolean)) {
      const child = node.children.get(part)
      if (!child) return false
      node = child
    }
    return true
  }
  forgetDirectories(): void {
    this.directories.children.clear()
  }
  private forgetDirectory(path: string): void {
    let node = this.directories
    const parts = path.split('/').filter(Boolean)
    for (const part of parts.slice(0, -1)) {
      const child = node.children.get(part)
      if (!child) return
      node = child
    }
    if (parts.length) node.children.delete(parts.at(-1))
    else this.forgetDirectories()
  }
  changed(...paths: string[]): void {
    for (const path of paths) {
      this.forgetDirectory(path)
      this.dirty.set(parentOf(path), ++this.generation)
    }
  }
  /** Durable ownership survived, but a process exit lost which barriers completed. */
  resume(paths: readonly string[]): void {
    for (const path of paths)
      for (let directory = parentOf(path); ; directory = parentOf(directory)) {
        this.dirty.set(directory, ++this.generation)
        if (!directory) break
      }
  }
  async flushAncestors(path: string, flush: (directory: string) => Promise<void>): Promise<void> {
    // Count the entire chain: between two awaited barriers no directory may be
    // queued, but the caller still owes its remaining ancestors.
    this.activeFlushes++
    try {
      for (let directory = parentOf(path); ; directory = parentOf(directory)) {
        if (this.dirty.has(directory)) await this.flushShared(directory, flush)
        if (!directory) break
      }
    } finally {
      if (--this.activeFlushes === 0) {
        const failure = this.failed.values().next()
        for (const stop of this.stops)
          if (failure.done) stop.resolve()
          else stop.reject(failure.value)
        this.stops.clear()
      }
    }
  }
  /** Producers must be stopped first. This wait does not cancel or abandon a barrier. */
  settled(): Promise<void> {
    if (this.activeFlushes)
      return new Promise((resolve, reject) => this.stops.add({ resolve, reject }))
    const [failure] = this.failed.values()
    return failure === undefined ? Promise.resolve() : Promise.reject(failure)
  }
  private flushShared(directory: string, flush: FlushWaiter['flush']): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter = { flush, resolve, reject }
      const pending = this.flushing.get(directory)
      if (pending) pending.push(waiter)
      else {
        this.flushing.set(directory, [waiter])
        void this.drain(directory)
      }
    })
  }
  private async drain(directory: string): Promise<void> {
    // Placements cross independent async metadata and save queues. Gather their
    // namespace changes for one host task before issuing a shared barrier.
    await yieldSyncTask()
    const pending = this.flushing.get(directory)
    while (pending.length) {
      const cohort = pending.splice(0)
      const generation = this.dirty.get(directory)
      try {
        await cohort[0].flush(directory)
        this.failed.delete(directory)
        if (this.dirty.get(directory) === generation) this.dirty.delete(directory)
        for (const waiter of cohort) waiter.resolve()
      } catch (error) {
        this.failed.set(
          directory,
          error instanceof Error
            ? error
            : new Error('Directory durability failed', { cause: error })
        )
        // A later cohort retries; failed callers never receive an acknowledgement.
        for (const waiter of cohort) waiter.reject(error)
      }
    }
    this.flushing.delete(directory)
  }
}

export function directEntryDurability(host: object): DirectEntryDurability {
  let state = Reflect.get(host, SHARED) as DirectEntryDurability | undefined
  if (!state) {
    state = new DirectEntryDurability()
    Reflect.set(host, SHARED, state)
  }
  return DirectEntryDurability.adopt(state)
}

/** A failed acknowledgement may follow a successful syscall. Keep its parents dirty. */
export async function entryEffect<T>(
  state: DirectEntryDurability,
  paths: string[],
  work: () => Promise<T>
): Promise<T> {
  state.changed(...paths)
  try {
    return await work()
  } finally {
    state.changed(...paths)
  }
}
