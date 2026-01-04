import { TAbstractFile, EventRef } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

type FileChangeType = 'modify' | 'rename' | 'delete'

type Callback = (event: FileChangeEvent) => void

export interface FileChangeEvent {
  type: FileChangeType
  file?: TAbstractFile
  oldPath?: string
  newPath?: string
}

export class VaultWatcherWrapper {
  private callbacks: Map<symbol, Callback> = new Map()
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

  registerCallback(callback: Callback) {
    const id = Symbol()
    this.callbacks.set(id, callback)
    return id
  }

  removeCallback(id: symbol) {
    this.callbacks.delete(id)
  }

  private startWatching(): void {
    if (this.isActive) return

    const { app } = GlobalStore.getInstance()

    this.eventRefs.push(
      app.vault.on('modify', (file: TAbstractFile) => {
        this.callbacks.forEach((callback) => {
          callback({
            type: 'modify',
            file,
            newPath: file.path,
          })
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        this.callbacks.forEach((callback) => {
          callback({
            type: 'rename',
            file,
            oldPath,
            newPath: file.path,
          })
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('delete', (file: TAbstractFile) => {
        this.callbacks.forEach((callback) => {
          callback({
            type: 'delete',
            oldPath: file.path,
          })
        })
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
