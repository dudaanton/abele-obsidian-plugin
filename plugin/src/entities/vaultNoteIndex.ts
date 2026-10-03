import { App, TFile, TFolder, type EventRef, normalizePath } from 'obsidian'
import dayjs from '@/helpers/dateLibrary'
import { DATE_FORMAT } from '@/constants/dates'
import { NoteTypeIndex, type IndexedNote } from './NoteTypeIndex'

export interface NoteIndexChange {
  path: string
  before?: IndexedNote
  after?: IndexedNote
}
class VaultNoteIndex extends NoteTypeIndex {
  private readonly events: EventRef[] = []
  private readonly listeners = new Set<(changes: NoteIndexChange[]) => void>()
  private readonly pending = new Set<string>()
  private watching = false
  private closed = false
  references = 0

  constructor(
    private readonly app: App,
    deferred: boolean
  ) {
    super()
    // Keep the startup paths for the first resolution: late metadata must be discovered,
    // but four lists and every journal must not enumerate the vault independently.
    for (const file of app.vault.getMarkdownFiles()) {
      this.read(file.path)
      this.pending.add(file.path)
    }
    if (!deferred) this.startWatching()
  }

  private startWatching() {
    if (this.watching) return
    this.watching = true
    const { app } = this
    this.events.push(
      app.metadataCache.on('changed', (file) => {
        if (!this.closed && file instanceof TFile) this.pending.add(normalizePath(file.path))
      })
    )
    this.events.push(
      app.vault.on('create', (file) => {
        if (!this.closed && file instanceof TFile) this.pending.add(normalizePath(file.path))
      })
    )
    this.events.push(
      app.vault.on('rename', (file, oldPath) => {
        if (!this.closed && file instanceof TFile) {
          this.pending.add(normalizePath(oldPath))
          this.pending.add(normalizePath(file.path))
        } else if (!this.closed && file instanceof TFolder) {
          const prefix = normalizePath(oldPath) + '/'
          for (const path of this.notes.keys())
            if (path.startsWith(prefix)) {
              this.pending.add(path)
              this.pending.add(normalizePath(file.path) + '/' + path.slice(prefix.length))
            }
        }
      })
    )
    this.events.push(
      app.vault.on('delete', (file) => {
        if (!this.closed && file instanceof TFile) this.pending.add(normalizePath(file.path))
        else if (!this.closed && file instanceof TFolder) {
          const prefix = normalizePath(file.path) + '/'
          for (const path of this.notes.keys()) if (path.startsWith(prefix)) this.pending.add(path)
        }
      })
    )
    this.events.push(
      app.metadataCache.on('resolved', () => {
        if (this.closed) return
        const paths = [...this.pending]
        this.pending.clear()
        const changes: NoteIndexChange[] = []
        for (const path of paths) {
          try {
            changes.push(this.read(path))
          } catch (error) {
            // Deliver successful deltas now; retaining only this path preserves its old
            // classification so a later successful read still emits the missing transition.
            this.pending.add(path)
            console.error('[Abele] note index could not read a pending change', error)
          }
        }
        if (changes.length) for (const listener of [...this.listeners]) listener(changes)
      })
    )
  }

  private read(path: string): NoteIndexChange {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile) || file.extension !== 'md')
      return { path, before: this.remove(path) }
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter
    const value = fm?.due ?? fm?.date ?? fm?.created
    const date = value ? dayjs(value, DATE_FORMAT) : null
    const after = { path, type: fm?.type, day: date?.isValid() ? date.format(DATE_FORMAT) : null }
    const before = this.upsert(after)
    return { path, before, after }
  }

  subscribe(listener: (changes: NoteIndexChange[]) => void): () => void {
    this.listeners.add(listener)
    this.startWatching()
    return () => this.listeners.delete(listener)
  }

  /** Keeps initial enumeration order even after an unrelated metadata update. */
  subscribeType(
    type: string,
    add: (path: string) => void,
    remove: (path: string) => void
  ): () => void {
    for (const path of this.pathsOfType(type)) add(path)
    return this.subscribe((changes) => {
      for (const change of changes) {
        if (change.before?.type === type && change.after?.type !== type) remove(change.path)
        if (change.after?.type === type) add(change.path)
      }
    })
  }

  dispose() {
    this.closed = true
    for (const ref of this.events) {
      this.app.vault.offref(ref)
      this.app.metadataCache.offref(ref)
    }
    this.listeners.clear()
    this.pending.clear()
  }
}

const indexes = new WeakMap<App, VaultNoteIndex>()
export function acquireVaultNoteIndex(app: App, deferred = false) {
  let index = indexes.get(app)
  if (!index) {
    index = new VaultNoteIndex(app, deferred)
    indexes.set(app, index)
  }
  index.references++
  let released = false
  return {
    index,
    release: () => {
      if (released) return
      released = true
      if (--index.references === 0) {
        index.dispose()
        indexes.delete(app)
      }
    },
  }
}
