import { parseDateOrNull } from '@/helpers/datesHelper'
import { FileWatcher } from '@/helpers/FileWatcher'
import { getFrontmatterFromCache, getNoteData } from '@/helpers/notesUtils'
import {
  extractAliasOrNameFromWikilink,
  getNameFromPath,
  normalizePath,
  wikilinkToPath,
} from '@/helpers/pathsHelpers'
import { getFileByPathOrName } from '@/helpers/vaultUtils'
import { genid } from '@/helpers/vueUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import dayjs from 'dayjs'
import { debounce } from 'obsidian'

export type AccountType = 'asset' | 'expense' | 'revenue' | 'liability'

export class Account {
  public readonly id: string
  private _accountPath: string
  private _accountName: string

  public title = ''
  public description = ''
  public accountType: AccountType | null = null
  public currency: string | null = null
  public startingBalance = 0
  public startingBalanceDate: dayjs.Dayjs | null = null
  public groups: string[] = []
  public excludeFromTotal = false

  public content = ''

  public loaded = false
  public accountNotFound = false
  public watcherInitialized = false
  private fileWatcher: FileWatcher = null

  private cleanedUp = false

  constructor(data: { id?: string; wikilink: string }) {
    this.id = data.id || genid()
    this._accountPath = wikilinkToPath(data.wikilink)
    this._accountName = extractAliasOrNameFromWikilink(data.wikilink)
  }

  async loadContent() {
    const note = await getNoteData(this.accountPath)

    if (note) {
      const lines = note.content.split('\n').filter((line: string) => line.trim() !== '')
      this.title = lines.length > 0 ? lines[0] : this._accountName
      this.description = lines.slice(1).join('\n')
      this.content = note.content
    } else {
      this.accountNotFound = true
    }
  }

  async load(force = false) {
    if (this.cleanedUp || (this.loaded && !force)) {
      return
    }
    this.loaded = true

    const frontmatter = getFrontmatterFromCache(this.accountPath)

    if (frontmatter) {
      this.accountType = frontmatter.accountType || null
      this.currency = frontmatter.currency || null
      this.startingBalance = Number(frontmatter.startingBalance) || 0
      this.startingBalanceDate = parseDateOrNull(frontmatter.startingBalanceDate)
      this.groups = Array.isArray(frontmatter.groups) ? frontmatter.groups : []
      this.excludeFromTotal = !!frontmatter.excludeFromTotal
    } else {
      this.accountNotFound = true
    }

    this.initWatcher()
  }

  get accountPath(): string {
    if (this._accountPath) return getFileByPathOrName(this._accountPath)?.path || this._accountPath

    const { accountsFolder } = AbeleConfig.getInstance()

    return normalizePath(
      accountsFolder ? `${accountsFolder}/${this._accountName}` : this._accountName
    )
  }

  get accountName(): string {
    return this._accountName
  }

  initWatcher() {
    if (this.watcherInitialized) {
      return
    }
    this.fileWatcher = new FileWatcher(
      GlobalStore.getInstance().app,
      this.accountPath,
      debounce(
        (event) => {
          if (event.oldPath && event.newPath && event.oldPath !== event.newPath) {
            this._accountPath = event.newPath
            this._accountName = getNameFromPath(event.newPath)
          }

          this.load(true)
          this.loadContent()
        },
        AbeleConfig.getInstance().refreshDelay,
        true
      )
    )

    this.watcherInitialized = true
  }

  cleanup() {
    this.cleanedUp = true
    this.fileWatcher?.cleanup()
    this.fileWatcher = null
    this.watcherInitialized = false
    this.title = ''
    this.description = ''
    this.accountType = null
    this.currency = null
    this.startingBalance = 0
    this.startingBalanceDate = null
    this.groups = []
    this.excludeFromTotal = false
    this.content = ''
    this.loaded = false
    this.accountNotFound = false
  }
}
