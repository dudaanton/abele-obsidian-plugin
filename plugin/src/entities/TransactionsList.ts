import { pathToWikilink } from '@/helpers/pathsHelpers'
import { GlobalStore } from '@/stores/GlobalStore'
import { EventRef, normalizePath, TAbstractFile, TFile } from 'obsidian'
import { Transaction } from './Transaction'
import { reactive, toRaw } from 'vue'

export class TransactionsList {
  transactions: Map<string, Transaction> = reactive(new Map())

  private isActive = false
  private resolved = false
  private eventRefs: EventRef[] = []

  private cleanedUp = false

  constructor() {
    this.findTransactions()
    this.startWatching()
  }

  private addTransaction(path: string) {
    path = normalizePath(path)
    if (!this.transactions.has(path)) {
      const transaction = reactive(new Transaction({ wikilink: pathToWikilink(path) }))
      transaction.load()
      this.transactions.set(path, transaction as Transaction)
    }
  }

  private removeTransaction(path: string): Transaction | undefined {
    path = normalizePath(path)

    const transaction = this.transactions.get(path)
    if (transaction) {
      transaction.cleanup()
      this.transactions.delete(path)
    }

    return transaction
  }

  private findTransactions(): void {
    const { app } = GlobalStore.getInstance()

    for (const file of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(file)

      if (cache?.frontmatter?.type === 'transaction') {
        this.addTransaction(file.path)
      }
    }
  }

  private isTransactionPath(path: string): boolean {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return false

    const cache = app.metadataCache.getFileCache(file)
    return cache?.frontmatter?.type === 'transaction'
  }

  private transactionRenameCallback(file: TFile, oldPath: string, newPath: string): void {
    oldPath = normalizePath(oldPath)
    newPath = normalizePath(newPath)
    if (this.transactions.has(oldPath)) {
      this.removeTransaction(oldPath)
      this.addTransaction(newPath)
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
        this.findTransactions()
        this.resolved = true
      })
    )

    this.eventRefs.push(
      app.metadataCache.on('changed', (file: TFile) => {
        this.relationsCallbacksQueue.push(() => {
          if (this.isTransactionPath(file.path)) {
            this.addTransaction(file.path)
          }
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        this.relationsCallbacksQueue.push(() => {
          if (file instanceof TFile) {
            this.transactionRenameCallback(file, oldPath, file.path)
          }
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('delete', (file: TAbstractFile) => {
        this.relationsCallbacksQueue.push(() => {
          if (file instanceof TFile) {
            this.removeTransaction(file.path)
          }
        })
      })
    )

    this.isActive = true
  }

  private removeTransactions(): void {
    this.transactions.forEach((transaction) => {
      this.removeTransaction(transaction.transactionPath)
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

    this.removeTransactions()
    this.isActive = false
  }
}
