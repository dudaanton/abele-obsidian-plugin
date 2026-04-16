import { pathToWikilink } from '@/helpers/pathsHelpers'
import { GlobalStore } from '@/stores/GlobalStore'
import { EventRef, normalizePath, TAbstractFile, TFile } from 'obsidian'
import { TimeEntry } from './TimeEntry'
import { computed, reactive, toRaw } from 'vue'

export class TimeEntryList {
  entries: Map<string, TimeEntry> = reactive(new Map())

  private isActive = false
  private resolved = false
  private eventRefs: EventRef[] = []

  private cleanedUp = false

  constructor() {
    this.findEntries()
    this.startWatching()
  }

  readonly activeEntry = computed(() => {
    for (const entry of this.entries.values()) {
      if (entry.isActive) return entry
    }
    return null
  })

  private addEntry(path: string) {
    path = normalizePath(path)
    if (!this.entries.has(path)) {
      const entry = reactive(new TimeEntry({ wikilink: pathToWikilink(path) }))
      entry.load()
      this.entries.set(path, entry as TimeEntry)
    }
  }

  private removeEntry(path: string): TimeEntry | undefined {
    path = normalizePath(path)

    const entry = this.entries.get(path)
    if (entry) {
      entry.cleanup()
      this.entries.delete(path)
    }

    return entry
  }

  private findEntries(): void {
    const { app } = GlobalStore.getInstance()

    for (const file of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(file)

      if (cache?.frontmatter?.type === 'time-entry') {
        this.addEntry(file.path)
      }
    }
  }

  private isEntryPath(path: string): boolean {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return false

    const cache = app.metadataCache.getFileCache(file)
    return cache?.frontmatter?.type === 'time-entry'
  }

  private entryRenameCallback(file: TFile, oldPath: string, newPath: string): void {
    oldPath = normalizePath(oldPath)
    newPath = normalizePath(newPath)
    if (this.entries.has(oldPath)) {
      this.removeEntry(oldPath)
      this.addEntry(newPath)
    }
  }

  private relationsCallbacksQueue: Array<() => void> = []

  private startWatching(): void {
    if (this.isActive) return

    const { app } = GlobalStore.getInstance()

    this.eventRefs.push(
      app.metadataCache.on('resolved', () => {
        const queue = this.relationsCallbacksQueue.splice(0)
        for (const callback of queue) {
          if (this.cleanedUp) return
          callback()
        }

        if (this.resolved) return
        this.findEntries()
        this.resolved = true
      })
    )

    this.eventRefs.push(
      app.metadataCache.on('changed', (file: TFile) => {
        this.relationsCallbacksQueue.push(() => {
          if (this.isEntryPath(file.path)) {
            this.addEntry(file.path)
          }
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        this.relationsCallbacksQueue.push(() => {
          if (file instanceof TFile) {
            this.entryRenameCallback(file, oldPath, file.path)
          }
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('delete', (file: TAbstractFile) => {
        this.relationsCallbacksQueue.push(() => {
          if (file instanceof TFile) {
            this.removeEntry(file.path)
          }
        })
      })
    )

    this.isActive = true
  }

  private removeEntries(): void {
    this.entries.forEach((entry) => {
      this.removeEntry(entry.entryPath)
    })
  }

  cleanup(): void {
    if (!this.isActive) return
    this.cleanedUp = true

    const { app } = GlobalStore.getInstance()

    this.eventRefs.forEach((ref) => {
      const rawRef = toRaw(ref)
      app.vault.offref(rawRef)
      app.metadataCache.offref(rawRef)
    })
    this.eventRefs = []

    this.removeEntries()
    this.isActive = false
  }
}
