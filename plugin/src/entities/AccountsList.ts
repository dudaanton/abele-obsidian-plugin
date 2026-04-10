import { pathToWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'
import { GlobalStore } from '@/stores/GlobalStore'
import { EventRef, normalizePath, TAbstractFile, TFile } from 'obsidian'
import { Account } from './Account'
import { reactive, toRaw } from 'vue'

export class AccountsList {
  accounts: Map<string, Account> = reactive(new Map())

  private isActive = false
  private resolved = false
  private eventRefs: EventRef[] = []

  private cleanedUp = false

  constructor() {
    this.findAccounts()
    this.startWatching()
  }

  private addAccount(path: string) {
    path = normalizePath(path)
    if (!this.accounts.has(path)) {
      const account = reactive(new Account({ wikilink: pathToWikilink(path) }))
      account.load()
      this.accounts.set(path, account as Account)
    }
  }

  private removeAccount(path: string): Account | undefined {
    path = normalizePath(path)

    const account = this.accounts.get(path)
    if (account) {
      account.cleanup()
      this.accounts.delete(path)
    }

    return account
  }

  private findAccounts(): void {
    const { app } = GlobalStore.getInstance()

    for (const file of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(file)

      if (cache?.frontmatter?.type === 'account') {
        this.addAccount(file.path)
      }
    }
  }

  private isAccountPath(path: string): boolean {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return false

    const cache = app.metadataCache.getFileCache(file)
    return cache?.frontmatter?.type === 'account'
  }

  private accountRenameCallback(file: TFile, oldPath: string, newPath: string): void {
    oldPath = normalizePath(oldPath)
    newPath = normalizePath(newPath)
    if (this.accounts.has(oldPath)) {
      this.removeAccount(oldPath)
      this.addAccount(newPath)
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
        this.findAccounts()
        this.resolved = true
      })
    )

    this.eventRefs.push(
      app.metadataCache.on('changed', (file: TFile) => {
        this.relationsCallbacksQueue.push(() => {
          if (this.isAccountPath(file.path)) {
            this.addAccount(file.path)
          }
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        this.relationsCallbacksQueue.push(() => {
          if (file instanceof TFile) {
            this.accountRenameCallback(file, oldPath, file.path)
          }
        })
      })
    )

    this.eventRefs.push(
      app.vault.on('delete', (file: TAbstractFile) => {
        this.relationsCallbacksQueue.push(() => {
          if (file instanceof TFile) {
            this.removeAccount(file.path)
          }
        })
      })
    )

    this.isActive = true
  }

  getAccountByWikilink(wikilink: string): Account | null {
    const { app } = GlobalStore.getInstance()
    const linkPath = wikilinkToPath(wikilink)
    const file = app.metadataCache.getFirstLinkpathDest(linkPath, '')
    if (!file) return null

    return this.accounts.get(normalizePath(file.path)) || null
  }

  private removeAccounts(): void {
    this.accounts.forEach((account) => {
      this.removeAccount(account.accountPath)
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

    this.removeAccounts()
    this.isActive = false
  }
}
