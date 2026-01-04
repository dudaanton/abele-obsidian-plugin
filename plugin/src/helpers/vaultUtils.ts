import { GlobalStore } from '@/stores/GlobalStore'
import { Editor, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian'
import { cleanFileName } from './pathsHelpers'

export const getFileByPathOrName = (pathOrName: string): TFile | null => {
  const app = GlobalStore.getInstance().app
  let file = app.vault.getAbstractFileByPath(pathOrName) as TFile

  if (!file) {
    file = app.metadataCache.getFirstLinkpathDest(pathOrName, '')

    if (!file) {
      console.warn(`File not found by path or name: ${pathOrName}`)
      return null
    }
  }

  return file
}

/**
 * Creates a new file in the Obsidian vault
 * @param app Obsidian App instance
 * @param fileName Name of the file to create (including extension)
 * @param content Content of the file
 * @param folderPath Optional folder path to create the file in
 * @returns Promise resolving to the created TFile
 */
export async function createNewFileInVault(
  fileName: string,
  content: string,
  folderPath?: string
): Promise<TFile> {
  const { app } = GlobalStore.getInstance()

  try {
    // Determine the full path for the file
    const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName

    // Check if file already exists
    const existingFile = app.vault.getAbstractFileByPath(fullPath)
    if (existingFile instanceof TFile) {
      console.log(`File ${fullPath} already exists, returning existing file`)
      return existingFile
    }

    // Create the file
    const file = await app.vault.create(fullPath, content)
    console.log(`Created new file: ${file.path}`)
    return file
  } catch (error) {
    console.error(`Error creating file ${fileName}:`, error)
    throw error
  }
}

/**
 * Checks if a file exists in the vault
 * @param app Obsidian App instance
 * @param path Path to the file
 * @returns Boolean indicating if the file exists
 */
export function fileExists(path: string): boolean {
  const { app } = GlobalStore.getInstance()

  const file = app.vault.getAbstractFileByPath(path)
  return file instanceof TFile
}

/**
 * Gets a file from the vault by path
 * @param app Obsidian App instance
 * @param path Path to the file
 * @returns TFile or null if not found
 */
export function getFileByPath(path: string): TFile | null {
  const { app } = GlobalStore.getInstance()

  const file = app.vault.getAbstractFileByPath(path)
  return file instanceof TFile ? file : null
}

/**
 * Reads the content of a file
 * @param app Obsidian App instance
 * @param file TFile to read
 * @returns Promise resolving to the file content
 */
export async function readDiskFileContent(file: TFile | string): Promise<string> {
  const { app } = GlobalStore.getInstance()

  if (typeof file === 'string') {
    const tfile = getFileByPath(file)
    if (!tfile) {
      throw new Error(`File not found: ${file}`)
    }
    file = tfile
  }
  return await app.vault.read(file)
}

export const readFileContent = async (file: TFile | string): Promise<string> => {
  if (typeof file === 'string') {
    file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(file) as TFile
  }

  const activeLeaf = GlobalStore.getInstance()
    .app.workspace.getLeavesOfType('markdown')
    .find((leaf: WorkspaceLeaf) => (leaf.view as MarkdownView).file?.path === file.path)

  const view = activeLeaf?.view as MarkdownView

  if (activeLeaf && view.editor) {
    // There is an open editor — read from it
    return view.editor.getValue()
  } else {
    // No editor — read from disk
    return GlobalStore.getInstance().app.vault.read(file)
  }
}

export function getEditorForFile(fileOrPath: TFile | string): Editor | null {
  const { app } = GlobalStore.getInstance()

  let file: TFile | null
  if (typeof fileOrPath === 'string') {
    file = getFileByPath(fileOrPath)
    if (!file) {
      console.warn(`File not found: ${fileOrPath}`)
      return null
    }
  } else {
    file = fileOrPath
  }

  const leaf = app.workspace
    .getLeavesOfType('markdown')
    .find((leaf) => (leaf.view as MarkdownView).file?.path === file.path)

  return (leaf?.view as MarkdownView)?.editor || null
}

/**
 * Writes content to a file
 * @param app Obsidian App instance
 * @param file TFile to write to
 * @param content Content to write
 * @returns Promise resolving when the write is complete
 */
export async function writeFileContent(file: TFile, content: string): Promise<void> {
  const { app } = GlobalStore.getInstance()

  return await app.vault.modify(file, content)
}

// // Regular expressions for matching wiki links and markdown links
// const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
// const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g

// Combined regex to match either wiki links or markdown links
export const linkRegex = /\!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)]+)\)/g

export async function openFile(pathOrName: string): Promise<void> {
  const { app } = GlobalStore.getInstance()
  const file = getFileByPathOrName(pathOrName)

  const leaf = app.workspace.getActiveViewOfType(MarkdownView)?.leaf
  if (leaf) {
    await leaf.openFile(file)
  } else {
    app.workspace.openLinkText(pathOrName, '', false)
  }

  // await app.workspace.getLeaf(true).openFile(file)
}

/**
 * A safe file name length limit for most filesystems (e.g., NTFS, ext4, APFS).
 * The full path limit is different, but this constant is for the name component only.
 */
const MAX_FILENAME_LENGTH = 250 // Using 250 for a safer margin.

/**
 * Finds an available and valid path for a new file.
 * If the path is taken, it appends a numeric suffix " (n)".
 * It also cleans the filename of invalid characters and truncates it if it's too long.
 * @param originalPath The desired original path (e.g., "Notes/My File: Special Edition.md").
 * @param suitablePath An optional path that is known to be suitable (e.g., from a previous check).
 * @returns A promise that resolves to an available and valid path string.
 */
export async function getAvailablePath(
  originalPath: string,
  suitablePath?: string
): Promise<string> {
  const { vault } = GlobalStore.getInstance().app

  // 1. Separate path into directory and filename.
  const parentDir = originalPath.includes('/')
    ? originalPath.substring(0, originalPath.lastIndexOf('/'))
    : ''
  const originalFileName = originalPath.substring(parentDir.length > 0 ? parentDir.length + 1 : 0)

  // 2. Clean the filename part using the provided helper.
  const cleanedFileName = cleanFileName(originalFileName)
  const initialPath = parentDir ? `${parentDir}/${cleanedFileName}` : cleanedFileName

  // 3. Immediately check if the cleaned path is available and has a valid length.
  if (
    suitablePath === initialPath ||
    (!(await vault.adapter.exists(initialPath)) && cleanedFileName.length <= MAX_FILENAME_LENGTH)
  ) {
    return initialPath
  }

  // 4. If the path is taken or the name is too long, we need to generate a new one.
  // Parse the cleaned name to separate the base and extension.
  const extensionIndex = cleanedFileName.lastIndexOf('.')
  const hasExtension = extensionIndex > -1 && extensionIndex > cleanedFileName.lastIndexOf('/')

  let baseName = hasExtension ? cleanedFileName.substring(0, extensionIndex) : cleanedFileName

  const extension = hasExtension ? cleanedFileName.substring(extensionIndex) : ''

  // 5. Truncate the baseName to ensure it will fit with a suffix like " (999)".
  // We reserve space for the suffix and potential extension.
  const suffixPlaceholder = ' (999)'
  const maxBaseNameLength = MAX_FILENAME_LENGTH - extension.length - suffixPlaceholder.length

  if (baseName.length > maxBaseNameLength) {
    baseName = baseName.substring(0, maxBaseNameLength).trimEnd()
  }

  // 6. Loop to find the first available path with a numeric suffix.
  let counter = 1
  while (true) {
    const newFileName = `${baseName} (${counter})${extension}`
    const newPath = parentDir ? `${parentDir}/${newFileName}` : newFileName

    // If a suitablePath is provided and matches the newPath, return it immediately
    if (suitablePath && newPath === suitablePath) {
      return newPath
    }

    if (!(await vault.adapter.exists(newPath))) {
      return newPath
    }
    counter++
  }
}

export function getBacklinksByPath(path: string): string[] {
  const { app } = GlobalStore.getInstance()

  app.metadataCache.trigger(path)

  const backlinks = []
  const allLinks = app.metadataCache.resolvedLinks

  // allLinks structure: { [sourcePath]: { [targetPath]: linkCount } }
  for (const sourcePath in allLinks) {
    // testing if sourcePath links to the given path
    if (allLinks[sourcePath][path]) {
      backlinks.push(sourcePath)
    }
  }

  return backlinks
}

export function getOutgoingLinksByPath(path: string): string[] {
  const { app } = GlobalStore.getInstance()

  app.metadataCache.trigger(path)

  const file = app.vault.getAbstractFileByPath(path) as TFile
  if (!file) return []

  const outgoingLinks = []
  const links = app.metadataCache.getFileCache(file)?.links || []
  const frontmatterLinks = app.metadataCache.getFileCache(file)?.frontmatterLinks || []

  for (const link of [...links, ...frontmatterLinks]) {
    const linkFile = app.metadataCache.getFirstLinkpathDest(link.link, path)
    if (linkFile) {
      outgoingLinks.push(linkFile.path)
    }
  }

  return outgoingLinks
}
