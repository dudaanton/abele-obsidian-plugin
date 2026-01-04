import { extractDateFromFilename, parseDateOrNull } from '@/helpers/datesHelper'
import { FileWatcher } from '@/helpers/FileWatcher'
import { getFrontmatterFromCache, getNoteData } from '@/helpers/notesUtils'
import { getNameFromPath, isWikilink, normalizePath, wikilinkToPath } from '@/helpers/pathsHelpers'
import { getOutgoingLinksByPath } from '@/helpers/vaultUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import dayjs from 'dayjs'
import { debounce, TFile } from 'obsidian'

export class Log {
  public filePath: string
  public targetFilePath: string | null = null

  public createdAt: dayjs.Dayjs | null = null
  public type: string | null = null
  public content: string

  public loaded = false
  public noteNotFound = false
  public watcherInitialized = false
  private fileWatcher: FileWatcher = null
  private targetFileWatcher: FileWatcher = null

  // to avoid debounced calls after cleanup
  private cleanedUp = false

  constructor(filePath: string, targetFilePath?: string) {
    this.filePath = normalizePath(filePath)
    this.targetFilePath = targetFilePath ? normalizePath(targetFilePath) : null
  }

  getLogDateOrToday(): dayjs.Dayjs {
    return this.createdAt ?? dayjs()
  }

  get name(): string {
    return getNameFromPath(this.filePath)
  }

  get wikilink(): string {
    return `[[${this.filePath}|${this.name}]]`
  }

  private checkIfPathIsInGroupsTree(
    path: string,
    targetNotePath: string,
    processedTreePaths: string[] = []
  ): boolean {
    const { app } = GlobalStore.getInstance()

    path = normalizePath(path)

    if (processedTreePaths.includes(path)) return false

    if (path === targetNotePath) return true

    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter

    const groups = frontmatter?.groups

    for (const group of groups || []) {
      if (!isWikilink(group)) continue

      const groupFile = app.metadataCache.getFirstLinkpathDest(wikilinkToPath(group), '')
      if (!groupFile) continue

      const groupPath = normalizePath(groupFile.path)

      return this.checkIfPathIsInGroupsTree(groupPath, targetNotePath, [
        ...processedTreePaths,
        path,
      ])
    }

    return false
  }

  private findRelatedLinks(): string[] {
    const links: string[] = []

    const outgoingLinks = getOutgoingLinksByPath(this.filePath)

    for (const link of outgoingLinks) {
      if (link === this.targetFilePath) {
        links.push(link)
      } else {
        if (this.checkIfPathIsInGroupsTree(link, this.targetFilePath)) {
          links.push(link)
        }
      }
    }

    return [...new Set(links)]
  }

  private getTargetWikiLinksPatternsFromPath(path: string): string[] {
    const targetWikilinks: string[] = []

    targetWikilinks.push(`[[${path.replace(/\.md$/, '')}`)
    targetWikilinks.push(`[[${path}`)
    targetWikilinks.push(`[[${getNameFromPath(path)}`)

    return targetWikilinks
  }

  async loadContent() {
    const data = await getNoteData(this.filePath)
    if (data) {
      let paragraphs = (data.content as string).split('\n\n').map((p) => p.trim())

      // find paragraphs containing one of wikilink type to targetFilePath (full path or name only)
      if (this.targetFilePath) {
        const targets = this.findRelatedLinks().flatMap((path) =>
          this.getTargetWikiLinksPatternsFromPath(path)
        )

        const newParagraphs = paragraphs.filter((p) =>
          targets.some((link) => p.toLowerCase().includes(link.toLowerCase()))
        )

        if (newParagraphs.length) {
          paragraphs = newParagraphs
        }
      }

      this.content = paragraphs.join('\n\n')
    } else {
      this.noteNotFound = true
    }
  }

  async load(force = false) {
    if (this.cleanedUp || (this.loaded && !force)) {
      return
    }
    this.loaded = true

    const frontmatter = getFrontmatterFromCache(this.filePath)

    this.createdAt = parseDateOrNull(frontmatter?.created) ?? extractDateFromFilename(this.name)
    this.type = frontmatter?.type || null

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
          console.log('log file changed')
        },
        AbeleConfig.getInstance().refreshDelay,
        true
      )
    )
    if (this.targetFilePath) {
      this.targetFileWatcher = new FileWatcher(
        GlobalStore.getInstance().app,
        this.targetFilePath,
        debounce(
          (event) => {
            if (event.oldPath && event.newPath && event.oldPath !== event.newPath) {
              // file renamed
              this.targetFilePath = event.newPath
            }

            console.log('target file changed')
            this.load(true)
            this.loadContent()
          },
          AbeleConfig.getInstance().refreshDelay,
          true
        )
      )
    }

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
    this.targetFileWatcher?.cleanup()
    this.fileWatcher = null
    this.targetFileWatcher = null
    this.watcherInitialized = false
    this.cleanData()
  }
}
