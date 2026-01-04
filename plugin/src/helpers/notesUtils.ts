import { DATE_FORMAT } from '@/constants/dates'
import { GlobalStore } from '@/stores/GlobalStore'
import { normalizePath, stringifyYaml, TAbstractFile, TFile, TFolder, Vault } from 'obsidian'
import fm from 'front-matter'
import { getFileByPath, getFileByPathOrName, readFileContent } from './vaultUtils'
import dayjs from 'dayjs'

const frontMatterRegex = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/

export function getNoteBody(content: string): string {
  return content.replace(frontMatterRegex, '')
}

export function getNoteRawFrontmatter(content: string): string | null {
  const match = content.match(frontMatterRegex)
  return match ? match[1] : null
}

export async function parseNoteContent(
  file: TFile,
  content: string
): Promise<{ content: string; [key: string]: any }> {
  // const { app } = GlobalStore.getInstance()

  // const bodyContent = getNoteBody(content)
  // let frontmatter = {}

  const parsed = fm<Record<string, any>>(content)

  const parsedData: Record<string, any> = {}
  for (const [key, value] of Object.entries(parsed.attributes)) {
    if (value instanceof Date) {
      parsedData[key] = dayjs(value).format(DATE_FORMAT)
    } else {
      parsedData[key] = value
    }
  }

  return { ...parsedData, content: parsed.body }

  // await app.fileManager.processFrontMatter(file, (f) => {
  //   frontmatter = { ...f }
  // })

  // return { ...parsed.attributes, content: parsed.body }
}

export const getNoteData = async (pathOrName: string): Promise<Record<string, any> | null> => {
  const { app } = GlobalStore.getInstance()

  const file = getFileByPathOrName(pathOrName)

  if (!file) {
    return null
  }

  const content = await app.vault.read(file)

  return parseNoteContent(file, content)
}

export const replaceNoteBody = (
  content: string, // full content with frontmatter
  newBodyContent: string // new body content without frontmatter
): string => {
  const frontmatter = getNoteRawFrontmatter(content)
  if (frontmatter) {
    return `---\n${frontmatter}\n---\n${newBodyContent}`
  } else {
    return newBodyContent
  }
}

/**
 * Updates specific frontmatter properties of a note while preserving the rest of the content
 * @param path Path to the note file
 * @param properties Object containing frontmatter properties to update
 * @returns Promise that resolves when the note is updated
 */
export const updateNoteFrontmatter = async (
  path: string,
  properties: Record<string, any>,
  includeCreated: boolean = false
): Promise<void> => {
  const { app } = GlobalStore.getInstance()
  const file = getFileByPath(path)

  if (!file) {
    throw new Error(`File not found: ${path}`)
  }

  // Read the current content of the note
  const content = await readFileContent(file)

  // Parse the frontmatter and content
  const parsed = fm<Record<string, any>>(content)

  const parsedAttributes = Object.keys(parsed.attributes).reduce(
    (obj, key) => {
      let value = parsed.attributes[key]
      if (value instanceof Date) {
        // Convert to DATE_FORMAT if it's a Date object
        value = dayjs(value).format(DATE_FORMAT)
      }

      obj[key] = value

      return obj
    },
    {} as Record<string, any>
  )

  // Update the frontmatter with the provided properties
  const updatedAttributes = { ...parsedAttributes, ...properties, ...{ name: undefined } }

  if (!(updatedAttributes as any).created && includeCreated) {
    // If 'created' is not provided, set it to the current date
    ;(updatedAttributes as any).created = dayjs().format(DATE_FORMAT)
  }

  // Convert the updated frontmatter to YAML
  const yamlFrontmatter = stringifyYaml(updatedAttributes)

  // Add the frontmatter delimiters
  const updatedContent = `---\n${yamlFrontmatter}\n---\n\n${parsed.body}`

  // Save the updated content back to the file
  await app.vault.modify(file, updatedContent)

  if (properties.name) {
    const newPath = file.path.split('/').slice(0, -1).join('/') + '/' + properties.name + '.md'
    if (newPath === file.path) return

    await app.fileManager.renameFile(file, newPath)
  }
}

/**
 * Removes all double newlines (consecutive empty lines) from a file and saves the modified content
 * Special handling for the beginning of the file: if it starts with multiple newlines, replace with a single newline
 * @param file The file to process
 * @returns Promise that resolves when the file is updated
 */
export const removeDoubleNewlines = async (file: TFile): Promise<void> => {
  const app = GlobalStore.getInstance().app

  // Get the current content of the file
  const content = await readFileContent(file)

  // First, handle the special case for the beginning of the file
  // If the file starts with multiple newlines, replace them with a single newline
  let updatedContent = content.replace(/^\r\r+/, '\n')

  // Then handle the rest of the file - replace multiple newlines with double newlines
  // Regular expression to match double newlines (two or more consecutive newlines)
  const doubleNewlinesRegex = /\r\r+/g
  updatedContent = updatedContent.replace(doubleNewlinesRegex, '\r\r')

  // Save the updated content back to the file
  await app.vault.modify(file, updatedContent)
}

export const getCurrentFile = () => GlobalStore.getInstance().app.workspace.getActiveFile()
export const getCurrentFilePath = () => getCurrentFile()?.path || ''

export function getFrontmatterFromCache(path: string): Record<string, any> | null {
  const { app } = GlobalStore.getInstance()

  const file = getFileByPath(path)
  if (!file) return null

  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
  if (!frontmatter) return null

  return frontmatter
}

export function getNotesFromFolder(folderStr: string): Array<TFile> {
  const { app } = GlobalStore.getInstance()
  folderStr = normalizePath(folderStr)

  const folder = app.vault.getAbstractFileByPath(folderStr)

  if (!folder || !(folder instanceof TFolder)) return []

  const files: Array<TFile> = []
  Vault.recurseChildren(folder, (file: TAbstractFile) => {
    if (file instanceof TFile) {
      files.push(file)
    }
  })

  files.sort((a, b) => {
    return a.path.localeCompare(b.path)
  })

  return files
}

export function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/{{(.*?)}}/g, (match, key) => {
    const trimmedKey = key.trim()

    if (trimmedKey.startsWith('date:')) {
      const formatString = trimmedKey.substring(5)
      try {
        return dayjs(data?.date, DATE_FORMAT).format(formatString)
      } catch (e) {
        console.error(`Error formatting date with dayjs: ${formatString}`, e)
        return ''
      }
    }

    return data[trimmedKey] || ''
  })
}

export async function createNoteFromTemplate(
  data: Record<string, string>,
  pathTemplate: string = 'Untitled',
  noteTemplatePath?: string
): Promise<TFile | null> {
  const { app } = GlobalStore.getInstance()

  let templateContent = ''
  if (noteTemplatePath) {
    const templateFile = app.vault.getAbstractFileByPath(noteTemplatePath)
    if (templateFile instanceof TFile) {
      templateContent = await app.vault.read(templateFile)
    }
  }

  const finalContent = renderTemplate(templateContent, data)
  let renderedPath = renderTemplate(pathTemplate, data).trim()

  if (!renderedPath) {
    renderedPath = 'Untitled'
  }
  if (!renderedPath.endsWith('.md')) {
    renderedPath += '.md'
  }

  const doesNoteExist = await app.vault.adapter.exists(renderedPath)
  if (doesNoteExist) {
    app.workspace.openLinkText(renderedPath, '', false)
    return null
  }

  // Create parent directories if they don't exist
  const parentPath = renderedPath.split('/').slice(0, -1).join('/')
  if (parentPath) {
    const parentExists = await app.vault.adapter.exists(parentPath)
    if (!parentExists) {
      await app.vault.createFolder(parentPath)
    }
  }

  const newFile = await app.vault.create(renderedPath, finalContent)

  app.workspace.openLinkText(newFile.path, '', false)

  return newFile
}
