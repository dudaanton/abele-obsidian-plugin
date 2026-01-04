import { App, TFile, TAbstractFile, EventRef } from 'obsidian'

type FileChangeType = 'modify' | 'rename' | 'delete'

export interface FileChangeEvent {
  type: FileChangeType
  file?: TFile
  oldPath?: string
  newPath?: string
}

export class VaultWatcher {
  private app: App
  private callbacks: Array<(event: FileChangeEvent) => void>
  private eventRefs: EventRef[] = []
  private isActive = false

  constructor(app: App) {
    this.app = app
    this.callbacks = []
    this.startWatching()
  }

  public registerCallback(callback: (event: FileChangeEvent) => void): VaultWatcher {
    this.callbacks.push(callback)

    return this
  }

  private startWatching(): void {
    if (this.isActive) return

    this.eventRefs.push(
      this.app.vault.on('modify', (file: TAbstractFile) => {
        if (file instanceof TFile) {
          for (const callback of this.callbacks) {
            callback({
              type: 'modify',
              file,
              newPath: file.path,
            })
          }
        }
      })
    )

    this.eventRefs.push(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) {
          for (const callback of this.callbacks) {
            callback({
              type: 'rename',
              file,
              oldPath,
              newPath: file.path,
            })
          }
        }
      })
    )

    this.eventRefs.push(
      this.app.vault.on('delete', (file: TAbstractFile) => {
        if (file instanceof TFile) {
          for (const callback of this.callbacks) {
            callback({
              type: 'delete',
              oldPath: file.path,
            })
          }
        }
      })
    )

    this.isActive = true
  }

  cleanup(): void {
    if (!this.isActive) return

    this.eventRefs.forEach((ref) => {
      this.app.vault.offref(ref)
    })

    this.eventRefs = []
    this.isActive = false
  }

  restart(): void {
    this.cleanup()

    this.startWatching()
  }
}
