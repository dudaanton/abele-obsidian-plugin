const SHARED = Symbol.for('abele.sync.direct-entry-durability-v1')
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
interface DirectoryNode {
  children: Map<string, DirectoryNode>
}

/** Evidence about our own namespace mutations, never about content or external writers. */
export class DirectEntryDurability {
  private readonly dirty = new Map<string, number>()
  private generation = 0
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
      const generation = this.dirty.get(directory)
      if (generation !== undefined) {
        await flush(directory)
        if (this.dirty.get(directory) === generation) this.dirty.delete(directory)
      }
      if (!directory) break
    }
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
