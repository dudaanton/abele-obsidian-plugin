import { GlobalStore } from '@/stores/GlobalStore'
import { App, MarkdownView, TFile, normalizePath } from 'obsidian'

/**
 * Abstract generic class for creating note templates
 * T represents the type of parameters needed for creating the template
 */
export abstract class GenericTemplate<T> {
  protected app: App

  /**
   * Constructor for the template class
   * @param app The Obsidian app instance
   */
  constructor(app: App) {
    this.app = app
  }

  getFullPath(params: T): string {
    // Get the filename from the parameters
    const filename = this.getFilename(params)
    // Get the path from the parameters
    const path = this.getPath(params)

    // Return the full path with filename
    return `${path}/${filename}.md`
  }

  /**
   * Creates a note with the template
   * @param params Parameters needed for the template, defined by generic type T
   * @param focus Whether to focus/open the note after creation (default: true)
   * @param overwrite Whether to overwrite an existing note (default: false)
   */
  public async createNoteWithTemplate(params: T, focus = true, overwrite = false): Promise<void> {
    // Get the filename and path from the parameters
    const fullpath = this.getFullPath(params)

    // Check if the file already exists
    const vault = this.app.vault
    const existingFile = vault.getAbstractFileByPath(`${fullpath}`)

    if (existingFile instanceof TFile && !overwrite) {
      // If the note already exists, open it
      if (focus) {
        this.app.workspace.openLinkText(fullpath, '', false)
      }
      return
    }

    // Generate content using the template
    const content = this.createTemplate(params)

    // Create the new note
    try {
      // checking if the directory exists, if not, create it
      const newFile = await this.createFileWithPath(`${fullpath}`, content, overwrite)
      // Open the created note
      if (focus) {
        const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf
        if (leaf) {
          await leaf.openFile(newFile)
        } else {
          this.app.workspace.openLinkText(fullpath, '', false)
        }
      }
    } catch (error) {
      console.error(`Error creating note ${fullpath}:`, error)
    }
  }

  protected async createFileWithPath(
    filePath: string,
    content = '',
    overwrite = false
  ): Promise<TFile> {
    const { app } = GlobalStore.getInstance()

    const pathParts = filePath.split('/')
    pathParts.pop() // remove the file name
    let currentPath = ''

    for (const part of pathParts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const folder = app.vault.getAbstractFileByPath(currentPath)
      if (!folder) {
        await app.vault.createFolder(currentPath)
      }
    }

    const normalizedPath = normalizePath(filePath)

    const existing = app.vault.getAbstractFileByPath(normalizedPath)
    if (existing) {
      if (overwrite && existing instanceof TFile) {
        await app.vault.modify(existing, content)
        return existing
      }
      throw new Error(`File already exists: ${normalizedPath}`)
    }

    return await app.vault.create(normalizedPath, content)
  }

  /**
   * Abstract method to determine the filename
   * Must be implemented by subclasses
   * @param params Parameters needed for the template
   * @returns The filename for the note (without extension)
   */
  protected abstract getFilename(params: T): string

  /**
   * Abstract method to determine the path for the note
   * Must be implemented by subclasses
   * @param params Parameters needed for the template
   * @returns The path where the note will be created
   */
  protected getPath(params: T): string {
    // Default path can be overridden by subclasses
    return 'Notes'
  }

  /**
   * Abstract method to create the template content
   * Must be implemented by subclasses
   * @param params Parameters needed for the template
   * @returns The content of the template
   */
  abstract createTemplate(params: T): string
}
