import { parseDateOrNull } from '@/helpers/datesHelper'
import { FileWatcher } from '@/helpers/FileWatcher'
import { getFrontmatterFromCache } from '@/helpers/notesUtils'
import { normalizePath } from '@/helpers/pathsHelpers'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import dayjs from 'dayjs'
import { debounce } from 'obsidian'
import { NoteRelations } from './NoteRelations'

export class Footer {
  public readonly id: string
  public filePath: string

  public createdAt: dayjs.Dayjs | null = null
  public type: string | null = null

  public loaded = false
  // public noteNotFound = false
  public watcherInitialized = false
  public noteRelations: NoteRelations = null
  private fileWatcher: FileWatcher = null

  // to avoid debounced calls after cleanup
  private cleanedUp = false

  constructor(data: { id: string; filePath: string }) {
    this.id = data.id
    this.filePath = normalizePath(data.filePath)
    this.noteRelations = new NoteRelations(this.filePath)
  }

  async load(force = false) {
    if (this.cleanedUp || (this.loaded && !force)) {
      return
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

  cleanFooterData() {
    this.createdAt = null
    this.type = null
    this.loaded = false
  }

  cleanup() {
    this.cleanedUp = true
    this.fileWatcher?.cleanup()
    this.fileWatcher = null
    this.watcherInitialized = false
    this.noteRelations.cleanup()
    this.cleanFooterData()
  }
}
