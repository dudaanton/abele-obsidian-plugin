import { TAbstractFile, EventRef } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { getFileNameFromPath, isPath, normalizePath } from './pathsHelpers'

type FileChangeType = 'modify' | 'rename' | 'delete'

type Callback = (event: FileChangeEvent) => void

export interface FileChangeEvent {
  type: FileChangeType
  file?: TAbstractFile
  oldPath?: string
  newPath?: string
}

/**
 * Dispatch keys — an O(1) index that reproduces comparePaths() exactly.
 *
 * comparePaths (helpers/pathsHelpers.ts) is, with
 *   full(p) = normalizePath(p)            // trimmed, outer slashes stripped, .md ensured
 *   name(p) = getFileNameFromPath(full(p))
 *   isP(p)  = isPath(p)                   // the RAW p contains '/'
 *
 *   comparePaths(a, b) = (!isP(a) || !isP(b)) ? name(a) === name(b) : full(a) === full(b)
 *
 * This is NOT an equivalence relation — it is not transitive ("a/x.md" ~ "x.md" ~ "b/x.md"
 * but "a/x.md" !~ "b/x.md"), so a single canonical key cannot exist. Instead each watcher is
 * registered under a SET of keys and each event is looked up under a SET of keys, chosen so
 * that the two sets intersect exactly when comparePaths(watcherPath, eventPath) is true:
 *
 *   watcher keys:  isP(w) ? ['f|' + full(w), 'n|' + name(w)]
 *                         : ['n|' + name(w), 'x|' + name(w)]
 *   event keys:    isP(e) ? ['f|' + full(e), 'x|' + name(e)]
 *                         : ['n|' + name(e)]
 *
 * Proof by the four cases (W = watcher path, E = event path):
 *   isP(W),  isP(E)  -> only the 'f|' family can meet -> full(W) === full(E) == comparePaths
 *   isP(W),  !isP(E) -> only the 'n|' family can meet -> name(W) === name(E) == comparePaths
 *   !isP(W), isP(E)  -> only the 'x|' family can meet -> name(W) === name(E) == comparePaths
 *   !isP(W), !isP(E) -> only the 'n|' family can meet -> name(W) === name(E) == comparePaths
 * In every case exactly one key family can intersect, so a watcher is never notified twice.
 */
function pathKeys(path: string, forEvent: boolean): string[] {
  // guard: comparePaths would throw on a non-string, which used to blow up the whole
  // fan-out loop; such a watcher simply never matches now
  if (typeof path !== 'string') return []

  const full = normalizePath(path)
  const name = getFileNameFromPath(full)

  if (isPath(path)) {
    return forEvent ? [`f|${full}`, `x|${name}`] : [`f|${full}`, `n|${name}`]
  }

  return forEvent ? [`n|${name}`] : [`n|${name}`, `x|${name}`]
}

export class VaultWatcherWrapper {
  // key -> (callback id -> callback); a Map (not a Set) so that two registrations sharing
  // the same function reference stay independently removable, as with the old symbol map
  private index: Map<string, Map<symbol, Callback>> = new Map()
  private entries: Map<symbol, { keys: string[]; callback: Callback }> = new Map()
  // subscribers that do their own, non-comparePaths filtering and must see every event
  private wildcards: Map<symbol, Callback> = new Map()
  private eventRefs: EventRef[] = []
  private isActive = false

  private static instance: VaultWatcherWrapper = null

  private constructor() {
    return
  }

  static getInstance(): VaultWatcherWrapper {
    if (!this.instance) {
      this.instance = new VaultWatcherWrapper()
      this.instance.startWatching()
    }
    return this.instance
  }

  static destroy() {
    VaultWatcherWrapper.getInstance().cleanup()
    this.instance = null
  }

  /**
   * @param callback - Callback to invoke on vault changes
   * @param filePath - Path the callback is interested in. When omitted the callback is treated
   *                   as a wildcard subscriber and receives every event (it filters on its own).
   */
  registerCallback(callback: Callback, filePath?: string) {
    const id = Symbol()

    if (filePath === undefined) {
      this.wildcards.set(id, callback)
      return id
    }

    const keys = pathKeys(filePath, false)
    this.entries.set(id, { keys, callback })
    keys.forEach((key) => this.addToIndex(key, id, callback))

    return id
  }

  /** Re-keys a registered callback after its watched path changed (e.g. rename) */
  updateCallbackPath(id: symbol, filePath: string) {
    const entry = this.entries.get(id)
    if (!entry) return

    const keys = pathKeys(filePath, false)
    if (keys.length === entry.keys.length && keys.every((key, i) => key === entry.keys[i])) return

    entry.keys.forEach((key) => this.removeFromIndex(key, id))
    entry.keys = keys
    keys.forEach((key) => this.addToIndex(key, id, entry.callback))
  }

  removeCallback(id: symbol) {
    this.wildcards.delete(id)

    const entry = this.entries.get(id)
    if (!entry) return

    entry.keys.forEach((key) => this.removeFromIndex(key, id))
    this.entries.delete(id)
  }

  private addToIndex(key: string, id: symbol, callback: Callback) {
    let bucket = this.index.get(key)
    if (!bucket) {
      bucket = new Map()
      this.index.set(key, bucket)
    }
    bucket.set(id, callback)
  }

  private removeFromIndex(key: string, id: symbol) {
    const bucket = this.index.get(key)
    if (!bucket) return

    bucket.delete(id)
    if (bucket.size === 0) this.index.delete(key)
  }

  /**
   * Dispatches to the subscribers of `matchPath` only, plus every wildcard subscriber.
   * Callbacks are snapshotted first: a callback may re-key or remove itself (rename/delete)
   * while the dispatch is running.
   */
  private dispatch(event: FileChangeEvent, matchPath: string): void {
    const startedAt = performance.now()

    const callbacks: Callback[] = []

    pathKeys(matchPath, true).forEach((key) => {
      const bucket = this.index.get(key)
      if (bucket) bucket.forEach((callback) => callbacks.push(callback))
    })

    this.wildcards.forEach((callback) => callbacks.push(callback))

    for (const callback of callbacks) {
      callback(event)
    }

    console.debug(
      `[Abele] perf: VaultWatcherWrapper dispatch ${event.type} ${matchPath} (${callbacks.length}/${this.entries.size} subscribers)`,
      performance.now() - startedAt
    )
  }

  private startWatching(): void {
    if (this.isActive) return

    const { app } = GlobalStore.getInstance()

    this.eventRefs.push(
      app.vault.on('modify', (file: TAbstractFile) => {
        this.dispatch(
          {
            type: 'modify',
            file,
            newPath: file.path,
          },
          file.path
        )
      })
    )

    this.eventRefs.push(
      app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        // watchers filter renames on oldPath, so the index is queried with the OLD path
        this.dispatch(
          {
            type: 'rename',
            file,
            oldPath,
            newPath: file.path,
          },
          oldPath
        )
      })
    )

    this.eventRefs.push(
      app.vault.on('delete', (file: TAbstractFile) => {
        this.dispatch(
          {
            type: 'delete',
            oldPath: file.path,
          },
          file.path
        )
      })
    )

    this.isActive = true
  }

  private cleanup(): void {
    if (!this.isActive) return

    this.eventRefs.forEach((ref) => {
      GlobalStore.getInstance().app.vault.offref(ref)
    })

    this.eventRefs = []
    this.isActive = false
  }
}
