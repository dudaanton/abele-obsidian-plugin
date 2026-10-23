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
    for (let directory = parentOf(path); ; directory = parentOf(directory)) {
      if (this.dirty.has(directory)) await this.flushShared(directory, flush)
      if (!directory) break
    }
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
    // Gather this turn's requests before starting their durability barrier.
    await Promise.resolve()
    const pending = this.flushing.get(directory)
    while (pending.length) {
      const cohort = pending.splice(0)
      const generation = this.dirty.get(directory)
      try {
        await cohort[0].flush(directory)
        if (this.dirty.get(directory) === generation) this.dirty.delete(directory)
        for (const waiter of cohort) waiter.resolve()
      } catch (error) {
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
  return state
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
