import { extractDateFromFilename, parseDateOrNull } from '@/helpers/datesHelper'
import { FileWatcher } from '@/helpers/FileWatcher'
import { getFrontmatterFromCache } from '@/helpers/notesUtils'
import { getNameFromPath, normalizePath } from '@/helpers/pathsHelpers'
import { coverLink } from '@/helpers/resourceUrl'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import dayjs from 'dayjs'
import { debounce, TFile } from 'obsidian'

export class Note {
  public filePath: string

  public createdAt: dayjs.Dayjs | null = null
  public updatedAt: dayjs.Dayjs | null = null
  public type: string | null = null
  /** The frontmatter `description`, for the line under the title on a backlink card. */
  public description: string | null = null
  /** What the frontmatter `cover` names — a path, a link name or a URL — unresolved. */
  public cover: string | null = null

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

    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(this.filePath)

    if (frontmatter) {
      this.createdAt = parseDateOrNull(frontmatter.created) ?? extractDateFromFilename(this.name)
      this.updatedAt =
        parseDateOrNull(frontmatter.updated) ??
        (file instanceof TFile ? dayjs(file.stat.mtime) : null)
      this.type = frontmatter.type || null
      this.description = descriptionOf(frontmatter.description)
      this.cover = coverLink(frontmatter.cover)
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
    this.updatedAt = null
    this.type = null
    this.description = null
    this.cover = null
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

/** A `description` as one piece of text: a list is joined, anything else that is not text is none. */
function descriptionOf(value: unknown): string | null {
  const text = Array.isArray(value)
    ? value.filter((v) => typeof v === 'string').join(', ')
    : typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : ''
  return text.trim() || null
}
