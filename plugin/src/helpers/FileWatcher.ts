import { App, TFile, TAbstractFile, EventRef } from 'obsidian'
import { comparePaths } from './pathsHelpers'
import { VaultWatcherWrapper } from './VaultWatcherWrapper'

type FileChangeType = 'modify' | 'rename' | 'delete'

export interface FileChangeEvent {
  type: FileChangeType
  file?: TFile
  oldPath?: string
  newPath?: string
}

export class FileWatcher {
  private app: App
  private filePath: string
  private callback: (event: FileChangeEvent) => void
  private callbackId: symbol
  private isActive = false

  constructor(app: App, filePath: string, callback: (event: FileChangeEvent) => void) {
    this.app = app
    this.filePath = filePath
    this.callback = callback
    this.startWatching()
  }

  private startWatching(): void {
    if (this.isActive) return

    this.callbackId = VaultWatcherWrapper.getInstance().registerCallback((event) => {
      if (event.type === 'modify') {
        const { file } = event
        if (file instanceof TFile && comparePaths(file.path, this.filePath)) {
          this.callback({
            type: 'modify',
            file,
            newPath: file.path,
          })
        }
      }

      if (event.type === 'rename') {
        const { oldPath, file } = event
        if (comparePaths(oldPath, this.filePath) && file instanceof TFile) {
          this.filePath = file.path

          this.callback({
            type: 'rename',
            file,
            oldPath,
            newPath: file.path,
          })
        }
      }

      if (event.type === 'delete') {
        const { file } = event
        if (file instanceof TFile && comparePaths(file.path, this.filePath)) {
          this.callback({
            type: 'delete',
            oldPath: file.path,
          })

          this.cleanup()
        }
      }
    })

    this.isActive = true
  }

  getCurrentPath(): string {
    return this.filePath
  }

  async fileExists(): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(this.filePath)
    return file instanceof TFile
  }

  getFile(): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(this.filePath)
    return file instanceof TFile ? file : null
  }

  cleanup(): void {
    if (!this.isActive) return

    if (this.callbackId) {
      VaultWatcherWrapper.getInstance().removeCallback(this.callbackId)
      this.callbackId = null
    }
    this.isActive = false
  }

  restart(newPath?: string): void {
    this.cleanup()

    if (newPath) {
      this.filePath = newPath
    }

    this.startWatching()
  }
}
