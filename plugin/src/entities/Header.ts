import { parseDateOrNull } from '@/helpers/datesHelper'
import { FileWatcher } from '@/helpers/FileWatcher'
import { getFrontmatterFromCache } from '@/helpers/notesUtils'
import { normalizePath } from '@/helpers/pathsHelpers'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import dayjs from 'dayjs'
import { debounce } from 'obsidian'
import { Journal } from './Journal'

export class Header {
  public readonly id: string
  public filePath: string
  public journal?: Journal
  public journalDate?: dayjs.Dayjs

  public createdAt: dayjs.Dayjs | null = null
  public type: string | null = null

  public loaded = false
  public watcherInitialized = false
  private fileWatcher: FileWatcher = null

  // to avoid debounced calls after cleanup
  private cleanedUp = false

  constructor(data: { id: string; filePath: string }) {
    this.id = data.id
    this.filePath = normalizePath(data.filePath)
  }

  async load(force = false) {
    if (this.cleanedUp || (this.loaded && !force)) {
      return
    }

    for (const journal of AbeleConfig.getInstance().journals) {
      const date = journal.checkIfNotePathIsJournal(this.filePath)
      if (date) {
        this.journal = journal
        this.journalDate = date

        break
      }
    }

    const frontmatter = getFrontmatterFromCache(this.filePath)

    if (frontmatter) {
      this.createdAt = parseDateOrNull(frontmatter.created)
      this.type = frontmatter.type || null
    }

    this.loaded = true
    this.initWatcher()
  }

  initWatcher() {
    if (this.watcherInitialized) {
      return
    }
    this.fileWatcher = new FileWatcher(
      GlobalStore.getInstance().app,
      this.filePath,
      debounce(
        (event) => {
          if (event.oldPath && event.newPath && event.oldPath !== event.newPath) {
            // file renamed
            this.filePath = event.newPath
          }

          this.load(true)
        },
        AbeleConfig.getInstance().refreshDelay,
        true
      )
    )

    this.watcherInitialized = true
  }

  cleanHeaderData() {
    this.createdAt = null
    this.type = null
    this.loaded = false
  }

  cleanup() {
    this.cleanedUp = true
    this.fileWatcher?.cleanup()
    this.fileWatcher = null
    this.watcherInitialized = false
    this.cleanHeaderData()
  }
}
