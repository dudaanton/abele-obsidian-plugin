import { isWikilink, pathToWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'
import { getBacklinksByPath, getOutgoingLinksByPath } from '@/helpers/vaultUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { EventRef, normalizePath, TAbstractFile, TFile } from 'obsidian'
import { Task } from './Task'
import { Log } from './Log'
import { Note } from './Note'
import { reactive } from 'vue'
import { Journal } from './Journal'
import dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'

export class NoteRelations {
  public filePath: string

  public journal: Journal | null
  public journalDate: dayjs.Dayjs | null

  tasks: Map<string, Task> = reactive(new Map())
  logs: Map<string, Log> = reactive(new Map())
  notes: Map<string, Note> = reactive(new Map())

  private isActive = false
  private resolved = false
  private eventRefs: EventRef[] = []

  // to avoid debounced calls after cleanup
  private cleanedUp = false

  constructor(filePath: string) {
    this.filePath = normalizePath(filePath)

    for (const journal of AbeleConfig.getInstance().journals) {
      const date = journal.checkIfNotePathIsJournal(this.filePath)
      if (date && journal.isDefault) {
        this.journal = journal
        this.journalDate = date

        break
      }
    }

    this.findRelations(this.filePath)
    this.startWatching()
  }

  private addTask(path: string) {
    path = normalizePath(path)
    if (!this.tasks.has(path)) {
      const task = reactive(new Task({ wikilink: pathToWikilink(path) }))
      task.load()
      this.tasks.set(path, task as Task)
    }
  }

  private removeTask(path: string) {
    path = normalizePath(path)

    const task = this.tasks.get(path)
    if (task) {
      task.cleanup()
      this.tasks.delete(path)
    }

    return task
  }

  private addLog(path: string) {
    path = normalizePath(path)
    if (!this.logs.has(path)) {
      const log = reactive(new Log(path, this.filePath))
      log.load()
      this.logs.set(path, log as Log)
    }
  }

  private removeLog(path: string) {
    path = normalizePath(path)

    const log = this.logs.get(path)
    if (log) {
      log.cleanup()
      this.logs.delete(path)
    }

    return log
  }

  private addNote(path: string) {
    path = normalizePath(path)
    if (!this.notes.has(path)) {
      const note = reactive(new Note(path))
      note.load()
      this.notes.set(path, note as Note)
    }
  }

  private removeNote(path: string) {
    path = normalizePath(path)

    const note = this.notes.get(path)
    if (note) {
      note.cleanup()
      this.notes.delete(path)
    }

    return note
  }

  private hasPath(path: string): boolean {
    path = normalizePath(path)
    return this.tasks.has(path) || this.logs.has(path) || this.notes.has(path)
  }

  /**
   * Adds a backlink and its nested relations to the respective maps
   * @param filePath - The main file path
   * @param backlink - The backlink to add
   * @param processedTreePaths - Internal parameter to avoid circular references
   */
  private addBacklink(filePath: string, backlink: string, processedTreePaths: string[] = []): void {
    const { app } = GlobalStore.getInstance()

    // avoid self-references
    if (normalizePath(backlink) === normalizePath(filePath)) return

    const file = app.vault.getAbstractFileByPath(backlink)
    if (!(file instanceof TFile)) return

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter

    const type = frontmatter?.type
    const groups = frontmatter?.groups

    if (!this.hasPath(file.path)) {
      if (type === 'task') {
        this.addTask(file.path)
      } else if (AbeleConfig.getInstance().isLogType(type, file.path)) {
        this.addLog(file.path)
      } else {
        this.addNote(file.path)
      }
    }

    // If the note is grouped into the current file, check for tasks and logs in the group note
    if (Array.isArray(groups) && groups.length > 0) {
      for (const group of groups) {
        if (!isWikilink(group)) continue

        const groupFile = app.metadataCache.getFirstLinkpathDest(wikilinkToPath(group), '')
        if (!groupFile) continue

        const groupPath = normalizePath(groupFile.path)
        if (groupPath === filePath && !processedTreePaths.includes(backlink)) {
          this.findRelations(file.path, [...processedTreePaths, backlink])
        }
      }
    }
  }

  /**
   * Finds all relations (tasks, logs, notes) linked to the given file path
   * and adds them to the respective maps
   * @param filePath - The file path to find relations for
   * @param processedTreePaths - Internal parameter to avoid circular references
   */
  findRelations(filePath: string, processedTreePaths: string[] = []): void {
    const { app } = GlobalStore.getInstance()

    filePath = normalizePath(filePath)

    const backlinks = getBacklinksByPath(filePath)

    for (const backlink of backlinks) {
      this.addBacklink(filePath, backlink, processedTreePaths)
    }

    if (this.journalDate && this.filePath === filePath) {
      const allNotes = app.vault.getMarkdownFiles()

      for (const note of allNotes) {
        if (note.path === this.filePath) continue

        const cache = app.metadataCache.getFileCache(note)?.frontmatter
        // TODO: consider refactor - this logic should be in Task class or at least in helpers
        const date = cache?.due ?? cache?.date ?? cache?.created

        if (!date) continue

        const parsedDate = dayjs(date, DATE_FORMAT)
        if (!parsedDate.isValid()) continue

        if (!parsedDate.isSame(this.journalDate, 'date')) continue

        if (cache.type === 'task') {
          this.addTask(note.path)
        } else if (AbeleConfig.getInstance().isLogType(cache.type, note.path)) {
          // Skip logs that are also journal notes (avoid showing one journal as log in another)
          const isDefaultJournal = AbeleConfig.getInstance().journals.some((j) =>
            j.checkIfNotePathIsJournal(note.path)
          )
          if (!isDefaultJournal) {
            this.addLog(note.path)
          }
        } else {
          this.addNote(note.path)
        }
      }
    }
  }

  /**
   * Is called when a relation is renamed
   * @param file - The renamed file
   * @param oldPath - The old path of the file
   * @param newPath - The new path of the file
   */
  private relationRenameCallback(file: TFile, oldPath: string, newPath: string): void {
    oldPath = normalizePath(oldPath)
    newPath = normalizePath(newPath)
    if (this.hasPath(oldPath)) {
      if (this.tasks.has(oldPath)) {
        this.removeTask(oldPath)
        this.addTask(newPath)
      } else if (this.logs.has(oldPath)) {
        this.removeLog(oldPath)
        this.addLog(newPath)
      } else if (this.notes.has(oldPath)) {
        this.removeNote(oldPath)
        this.addNote(newPath)
      }
    }
  }

  /**
   * Checks if the given path is related to the main file dirctly or via groups
   * @param path - The path to check
   * @param processedTreePaths - Internal parameter to avoid circular references
   * @returns True if the path is related, false otherwise
   */
  private isRelatedPath(path: string, processedTreePaths: string[] = []): boolean {
    const { app } = GlobalStore.getInstance()

    path = normalizePath(path)
    const backlinks = getBacklinksByPath(this.filePath)

    // direct backlink
    if (backlinks.indexOf(path) !== -1) {
      return true
    }

    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter

    if (this.journalDate) {
      const createdDate = frontmatter?.created

      if (createdDate) {
        const parsedDate = dayjs(createdDate)
        if (parsedDate.isValid()) {
          if (parsedDate.isSame(this.journalDate, 'date')) return true
        }
      }
    }

    const type = frontmatter?.type

    if (AbeleConfig.getInstance().isLogType(type, path) || type === 'task') {
      const outgoingLinks = getOutgoingLinksByPath(path)
      for (const link of outgoingLinks) {
        if (!processedTreePaths.includes(link)) {
          if (this.isRelatedPath(link, [...processedTreePaths, path])) return true
        }
      }

      return null
    }

    const groups = frontmatter?.groups

    if (Array.isArray(groups) && groups.length > 0) {
      for (const group of groups) {
        if (!isWikilink(group)) continue

        const groupFile = app.metadataCache.getFirstLinkpathDest(wikilinkToPath(group), '')
        if (!groupFile) continue

        const groupPath = normalizePath(groupFile.path)

        // check if the group note links to the main file
        if (!processedTreePaths.includes(groupPath)) {
          if (this.isRelatedPath(groupPath, [...processedTreePaths, path])) return true
        }
      }
    }

    return null
  }

  /**
   * Is called when a relation in removed from the note (e.g. link deleted from the content),
   * but not if the note itself is deleted
   * @param path - The path of the deleted relation
   */
  private unlinkPath(path: string): void {
    path = normalizePath(path)

    const task = this.removeTask(path)
    const log = this.removeLog(path)
    const note = this.removeNote(path)

    if (!task && !log && !note) return

    this.removeRemainingRelations()
  }

  /**
   * Removes all relations that are no longer linked from the main file
   */
  private removeRemainingRelations(): void {
    const allPaths = [...this.tasks.keys(), ...this.logs.keys(), ...this.notes.keys()]

    for (const path of allPaths) {
      if (!this.isRelatedPath(path)) {
        this.removeTask(path)
        this.removeLog(path)
        this.removeNote(path)
      }
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
        this.findRelations(this.filePath)
        this.resolved = true
      })
    )

    this.eventRefs.push(
      app.metadataCache.on('changed', (file: TFile) => {
        this.relationsCallbacksQueue.push(() => {
          if (this.isRelatedPath(file.path)) {
            this.addBacklink(this.filePath, file.path)
          } else if (this.hasPath(file.path)) {
            this.unlinkPath(file.path)
          }
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        this.relationsCallbacksQueue.push(() => {
          if (normalizePath(oldPath) === this.filePath && file instanceof TFile) {
            // update tracked path
            this.filePath = file.path

            const oldJournal = this.journal
            this.journal = null
            this.journalDate = null
            for (const journal of AbeleConfig.getInstance().journals) {
              const date = journal.checkIfNotePathIsJournal(this.filePath)
              if (date) {
                this.journal = journal
                this.journalDate = date

                break
              }
            }
            if (oldJournal !== this.journal) {
              this.removeRemainingRelations()
              this.findRelations(this.filePath)
            }
          } else if (file instanceof TFile) {
            this.relationRenameCallback(file, oldPath, file.path)
          }
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('delete', (file: TAbstractFile) => {
        this.relationsCallbacksQueue.push(() => {
          if (file instanceof TFile && normalizePath(file.path) === this.filePath) {
            this.cleanup()
          } else if (file instanceof TFile) {
            this.removeRemainingRelations()
          }
        })
      })
    )

    this.isActive = true
  }

  removeRelations(): void {
    this.tasks.forEach((_, path) => {
      this.removeTask(path)
    })

    this.logs.forEach((_, path) => {
      this.removeLog(path)
    })

    this.notes.forEach((_, path) => {
      this.removeNote(path)
    })
  }

  cleanup(): void {
    if (!this.isActive) return
    this.cleanedUp = true

    const { app } = GlobalStore.getInstance()

    this.eventRefs.forEach((ref) => {
      app.vault.offref(ref)
    })
    this.eventRefs = []

    this.removeRelations()
    this.isActive = false
  }
}
