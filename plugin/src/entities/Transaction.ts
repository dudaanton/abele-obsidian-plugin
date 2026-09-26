import { DATE_FORMAT } from '@/constants/dates'
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
import { TransactionNoteTemplate } from '@/templates/TransactionNoteTemplate'
import dayjs from 'dayjs'
import { debounce } from 'obsidian'

export interface TransactionCreateDTO {
  title?: string
  description?: string
  date?: dayjs.Dayjs
  from?: string
  to?: string
  amount?: number
  currency?: string
  foreignAmount?: number
  foreignCurrency?: string
  category?: string
  groups?: string[]
  content?: string
  oldProps?: Record<string, any>
}

export class Transaction {
  public readonly id: string
  private _transactionPath: string
  private _transactionName: string
  public readonly filePath?: string

  public title = ''
  public description = ''
  public date: dayjs.Dayjs | null = null
  public from: string | null = null
  public to: string | null = null
  public amount: number | null = null
  public currency: string | null = null
  public foreignAmount: number | null = null
  public foreignCurrency: string | null = null
  public category: string | null = null
  public groups: string[] = []

  public content = ''
  public oldProps: Record<string, any> = {}

  public loaded = false
  public transactionNotFound = false
  public watcherInitialized = false
  private fileWatcher: FileWatcher = null

  private cleanedUp = false

  constructor(data: TransactionCreateDTO & { id?: string; wikilink: string; filePath?: string }) {
    this.id = data.id || genid()
    this._transactionPath = wikilinkToPath(data.wikilink)
    this._transactionName = extractAliasOrNameFromWikilink(data.wikilink)
    this.filePath = data.filePath ? normalizePath(data.filePath) : undefined

    this.title = data.title || ''
    this.description = data.description || ''
    this.date = data.date || null
    this.from = data.from || null
    this.to = data.to || null
    this.amount = data.amount ?? null
    this.currency = data.currency || null
    this.foreignAmount = data.foreignAmount ?? null
    this.foreignCurrency = data.foreignCurrency || null
    this.category = data.category || null
    this.groups = data.groups || []
    this.content = data.content || ''
    this.oldProps = data.oldProps || {}
  }

  async loadContent() {
    const note = await getNoteData(this.transactionPath)

    if (note) {
      const lines = note.content.split('\n').filter((line: string) => line.trim() !== '')
      this.title = lines.length > 0 ? lines[0] : 'New Transaction'
      this.description = lines.slice(1).join('\n')
      this.content = note.content
    } else {
      this.transactionNotFound = true
    }
  }

  async load(force = false) {
    if (this.cleanedUp || (this.loaded && !force)) {
      return
    }
    this.loaded = true

    const frontmatter = getFrontmatterFromCache(this.transactionPath)

    if (frontmatter) {
      this.date = parseDateOrNull(frontmatter.date)
      this.from = frontmatter.from || null
      this.to = frontmatter.to || null
      this.amount = frontmatter.amount != null ? Number(frontmatter.amount) : null
      this.currency = frontmatter.currency || null
      this.foreignAmount =
        frontmatter.foreignAmount != null ? Number(frontmatter.foreignAmount) : null
      this.foreignCurrency = frontmatter.foreignCurrency || null
      this.category = frontmatter.category || null
      this.groups = Array.isArray(frontmatter.groups) ? frontmatter.groups : []

      this.oldProps = { ...frontmatter, content: undefined }
    } else {
      this.transactionNotFound = true
    }

    this.initWatcher()
  }

  get transactionPath(): string {
    if (this._transactionPath) {
      return getFileByPathOrName(this._transactionPath)?.path || this._transactionPath
    }

    return normalizePath(this._transactionName)
  }

  get transactionFolder(): string {
    const parts = this.transactionPath.split('/')
    parts.pop()
    return parts.join('/')
  }

  get transactionName(): string {
    return this._transactionName
  }

  getTransactionDate(): dayjs.Dayjs | null {
    return this.date
  }

  isTransactionRelatedToDate(date: dayjs.Dayjs): boolean {
    return this.date ? this.date.format(DATE_FORMAT) === date.format(DATE_FORMAT) : false
  }

  async writeTransactionToFile(focus = false, overwrite = true) {
    const { app } = GlobalStore.getInstance()
    new TransactionNoteTemplate(app).createNoteWithTemplate(this, focus, overwrite)
  }

  initWatcher() {
    if (this.watcherInitialized) {
      return
    }
    this.fileWatcher = new FileWatcher(
      GlobalStore.getInstance().app,
      this.transactionPath,
      debounce(
        (event) => {
          if (event.oldPath && event.newPath && event.oldPath !== event.newPath) {
            this._transactionPath = event.newPath
            this._transactionName = getNameFromPath(event.newPath)
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

  toCreateDTO(): TransactionCreateDTO {
    return {
      title: this.title,
      description: this.description,
      date: this.date,
      from: this.from,
      to: this.to,
      amount: this.amount,
      currency: this.currency,
      foreignAmount: this.foreignAmount,
      foreignCurrency: this.foreignCurrency,
      category: this.category,
      groups: [...this.groups],
      content: this.content,
      oldProps: this.oldProps,
    }
  }

  async remove() {
    const { app } = GlobalStore.getInstance()
    const file = getFileByPathOrName(this.transactionPath)
    if (file) {
      await app.fileManager.trashFile(file)
    }
    this.cleanup()
  }

  cleanup() {
    this.cleanedUp = true
    this.fileWatcher?.cleanup()
    this.fileWatcher = null
    this.watcherInitialized = false
    this.title = ''
    this.description = ''
    this.date = null
    this.from = null
    this.to = null
    this.amount = null
    this.currency = null
    this.foreignAmount = null
    this.foreignCurrency = null
    this.category = null
    this.groups = []
    this.content = ''
    this.loaded = false
    this.transactionNotFound = false
    this.oldProps = {}
  }
}
