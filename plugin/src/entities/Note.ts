import { extractDateFromFilename, parseDateOrNull } from '@/helpers/datesHelper'
import { FileWatcher } from '@/helpers/FileWatcher'
import { getFrontmatterFromCache } from '@/helpers/notesUtils'
import { getNameFromPath, normalizePath } from '@/helpers/pathsHelpers'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import dayjs from 'dayjs'
import { debounce } from 'obsidian'

export class Note {
  public filePath: string

  public createdAt: dayjs.Dayjs | null = null
  public type: string | null = null

  public loaded = false
  public noteNotFound = false
  public watcherInitialized = false
  private fileWatcher: FileWatcher = null

  // to avoid debounced calls after cleanup
  private cleanedUp = false

  constructor(filePath: string) {
    this.filePath = normalizePath(filePath)
  }

  get name(): string {
    return getNameFromPath(this.filePath)
  }

  getNoteDateOrToday(): dayjs.Dayjs {
    return this.createdAt ?? dayjs()
  }

  async load(force = false) {
    if (this.cleanedUp || (this.loaded && !force)) {
      return
    }
    this.loaded = true

    const frontmatter = getFrontmatterFromCache(this.filePath)

    if (frontmatter) {
      this.createdAt = parseDateOrNull(frontmatter.created) ?? extractDateFromFilename(this.name)
      this.type = frontmatter.type || null
    } else {
      this.noteNotFound = true
    }

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

  cleanData() {
    this.createdAt = null
    this.type = null
    this.loaded = false
  }

  cleanup() {
    this.cleanedUp = true
    this.fileWatcher?.cleanup()
    this.fileWatcher = null
    this.watcherInitialized = false
    this.cleanData()
  }
}
