import { pathToWikilink } from '@/helpers/pathsHelpers'
import { GlobalStore } from '@/stores/GlobalStore'
import { EventRef, normalizePath, TAbstractFile, TFile } from 'obsidian'
import { Task } from './Task'
import { reactive } from 'vue'

export class TasksList {
  // public readonly id: string
  tasks: Map<string, Task> = reactive(new Map())

  private isActive = false
  private resolved = false
  private eventRefs: EventRef[] = []

  // to avoid debounced calls after cleanup
  private cleanedUp = false

  // constructor(data: { id: string }) {
  constructor() {
    // this.id = data.id
    this.findTasks()
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

  private findTasks(): void {
    const { app } = GlobalStore.getInstance()

    for (const file of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(file)

      if (cache?.frontmatter?.type === 'task') {
        this.addTask(file.path)
      }
    }
  }

  private isTaskPath(path: string): boolean {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return false

    const cache = app.metadataCache.getFileCache(file)
    return cache?.frontmatter?.type === 'task'
  }

  private taskRenameCallback(file: TFile, oldPath: string, newPath: string): void {
    oldPath = normalizePath(oldPath)
    newPath = normalizePath(newPath)
    if (this.tasks.has(oldPath)) {
      this.removeTask(oldPath)
      this.addTask(newPath)
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
        this.findTasks()
        this.resolved = true
      })
    )

    this.eventRefs.push(
      app.metadataCache.on('changed', (file: TFile) => {
        this.relationsCallbacksQueue.push(() => {
          if (this.isTaskPath(file.path)) {
            this.addTask(file.path)
          }
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        this.relationsCallbacksQueue.push(() => {
          if (file instanceof TFile) {
            this.taskRenameCallback(file, oldPath, file.path)
          }
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('delete', (file: TAbstractFile) => {
        this.relationsCallbacksQueue.push(() => {
          if (file instanceof TFile) {
            this.removeTask(file.path)
          }
        })
      })
    )

    this.isActive = true
  }

  private removeTasks(): void {
    this.tasks.forEach((task) => {
      this.removeTask(task.taskPath)
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

    this.removeTasks()
    this.isActive = false
  }
}
