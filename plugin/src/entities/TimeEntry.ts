import { FileWatcher } from '@/helpers/FileWatcher'
import { getFrontmatterFromCache } from '@/helpers/notesUtils'
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

export const DATETIME_FORMAT = 'YYYY-MM-DDTHH:mm:ss'

export interface TimeEntryCreateDTO {
  start?: dayjs.Dayjs
  end?: dayjs.Dayjs | null
  groups?: string[]
}

export class TimeEntry {
  public readonly id: string
  private _entryPath: string
  private _entryName: string
  public readonly filePath?: string

  public start: dayjs.Dayjs | null = null
  public end: dayjs.Dayjs | null = null
  public groups: string[] = []

  public loaded = false
  public entryNotFound = false
  public watcherInitialized = false
  private fileWatcher: FileWatcher = null

  private cleanedUp = false

  constructor(data: TimeEntryCreateDTO & { id?: string; wikilink: string; filePath?: string }) {
    this.id = data.id || genid()
    this._entryPath = wikilinkToPath(data.wikilink)
    this._entryName = extractAliasOrNameFromWikilink(data.wikilink)
    this.filePath = data.filePath ? normalizePath(data.filePath) : undefined

    this.start = data.start || null
    this.end = data.end || null
    this.groups = data.groups || []
  }

  async load(force = false) {
    if (this.cleanedUp || (this.loaded && !force)) {
      return
    }
    this.loaded = true

    const frontmatter = getFrontmatterFromCache(this.entryPath)

    if (frontmatter) {
      this.start = frontmatter.start ? dayjs(frontmatter.start) : null
      this.end = frontmatter.end ? dayjs(frontmatter.end) : null
      this.groups = Array.isArray(frontmatter.groups) ? frontmatter.groups : []
    } else {
      this.entryNotFound = true
    }

    this.initWatcher()
  }

  get entryPath(): string {
    if (this._entryPath) {
      return getFileByPathOrName(this._entryPath)?.path || this._entryPath
    }

    return normalizePath(this._entryName)
  }

  get entryFolder(): string {
    const parts = this.entryPath.split('/')
    parts.pop()
    return parts.join('/')
  }

  get entryName(): string {
    return this._entryName
  }

  get isActive(): boolean {
    return this.start !== null && this.end === null
  }

  get duration(): number {
    if (!this.start) return 0
    const endTime = this.end || dayjs()
    return endTime.diff(this.start, 'second')
  }

  get date(): dayjs.Dayjs | null {
    return this.start
  }

  initWatcher() {
    if (this.watcherInitialized) {
      return
    }
    this.fileWatcher = new FileWatcher(
      GlobalStore.getInstance().app,
      this.entryPath,
      debounce(
        (event) => {
          if (event.oldPath && event.newPath && event.oldPath !== event.newPath) {
            this._entryPath = event.newPath
            this._entryName = getNameFromPath(event.newPath)
          }

          this.load(true)
        },
        AbeleConfig.getInstance().refreshDelay,
        true
      )
    )

    this.watcherInitialized = true
  }

  toCreateDTO(): TimeEntryCreateDTO {
    return {
      start: this.start,
      end: this.end,
      groups: [...this.groups],
    }
  }

  cleanup() {
    this.cleanedUp = true
    this.fileWatcher?.cleanup()
    this.fileWatcher = null
    this.watcherInitialized = false
    this.start = null
    this.end = null
    this.groups = []
    this.loaded = false
    this.entryNotFound = false
  }
}
