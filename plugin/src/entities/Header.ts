import { parseDateOrNull } from '@/helpers/datesHelper'
import { FileWatcher } from '@/helpers/FileWatcher'
import { getFrontmatterFromCache } from '@/helpers/notesUtils'
import { normalizePath } from '@/helpers/pathsHelpers'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import dayjs from 'dayjs'
import { debounce, type EventRef, type TFile } from 'obsidian'
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
  private metadataRefs: EventRef[] = []

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

    this.tellJournal()

    const frontmatter = getFrontmatterFromCache(this.filePath)

    if (frontmatter) {
      this.createdAt = parseDateOrNull(frontmatter.created)
      this.type = frontmatter.type || null
    }

    this.loaded = true
    this.initWatcher()
  }

  /** Which journal this note is, and its day — told from the note's metadata. */
  private tellJournal() {
    this.journal = undefined
    this.journalDate = undefined
    for (const journal of AbeleConfig.getInstance().journals) {
      const date = journal.checkIfNotePathIsJournal(this.filePath)
      if (date) {
        this.journal = journal
        this.journalDate = date

        break
      }
    }
  }

  /**
   * A note open when Obsidian starts is reached before the metadata cache has read it, and is
   * told to be no journal at all — so it is told again when its metadata arrives: when the note
   * itself is reported read, and once when the first pass over the vault ends.
   */
  private watchMetadata() {
    const { metadataCache } = GlobalStore.getInstance().app
    const retell = () => {
      if (!this.cleanedUp) this.tellJournal()
    }
    this.metadataRefs.push(
      metadataCache.on('changed', (file: TFile) => {
        if (normalizePath(file.path) === this.filePath) retell()
      })
    )
    const resolved = metadataCache.on('resolved', () => {
      metadataCache.offref(resolved)
      this.metadataRefs = this.metadataRefs.filter((ref) => ref !== resolved)
      retell()
    })
    this.metadataRefs.push(resolved)
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

    this.watchMetadata()
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
    const metadataCache = GlobalStore.getInstance().app?.metadataCache
    for (const ref of this.metadataRefs) metadataCache?.offref(ref)
    this.metadataRefs = []
    this.watcherInitialized = false
    this.cleanHeaderData()
  }
}
