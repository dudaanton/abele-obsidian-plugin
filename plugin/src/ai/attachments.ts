import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import type { UserContentPart } from './client'
import { isImagePath } from './tools/ReadImageTool'

const MAX_TEXT_FILE_SIZE = 100 * 1024 // 100 KB

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
const TEXT_EXTENSIONS = [
  'md',
  'txt',
  'json',
  'csv',
  'xml',
  'yaml',
  'yml',
  'toml',
  'js',
  'ts',
  'jsx',
  'tsx',
  'css',
  'scss',
  'html',
  'htm',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'cpp',
  'h',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'bat',
  'sql',
  'graphql',
  'proto',
  'env',
  'ini',
  'conf',
  'cfg',
  'properties',
  'log',
  'diff',
  'patch',
]
const ALLOWED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...TEXT_EXTENSIONS]

export function isAllowedAttachment(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return ALLOWED_EXTENSIONS.includes(ext)
}

export const ALLOWED_ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')

/**
 * Resolve attachment vault paths into UserContentPart[] for the API.
 * Images → image_url with vault: reference (resolved to base64 at send time).
 * Text files → inline text content.
 */
export async function resolveAttachmentsForApi(paths: string[]): Promise<UserContentPart[]> {
  const { app } = GlobalStore.getInstance()
  const parts: UserContentPart[] = []

  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) {
      parts.push({ type: 'text', text: `[Attachment unavailable: ${path}]` })
      continue
    }

    if (isImagePath(path)) {
      parts.push({ type: 'text', text: `[Attached image: ${path}]` })
    } else {
      try {
        let content = await app.vault.read(file)
        if (file.stat.size > MAX_TEXT_FILE_SIZE) {
          content = content.slice(0, MAX_TEXT_FILE_SIZE) + '\n\n[... truncated]'
        }
        parts.push({ type: 'text', text: `--- ${file.name} ---\n${content}` })
      } catch {
        parts.push({ type: 'text', text: `[Cannot read: ${path}]` })
      }
    }
  }

  return parts
}

/**
 * Import an external file (from system file picker) into the vault attachment folder.
 */
export async function importExternalFile(file: File): Promise<TFile> {
  const { app } = GlobalStore.getInstance()

  // Use Obsidian's configured attachment folder, fallback to "Attachments"
  let folder = (app.vault as any).getConfig?.('attachmentFolderPath') || 'Attachments'
  if (folder === '/' || folder === '.') folder = ''

  // Ensure folder exists
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder)
  }

  // Avoid name collisions
  const basePath = folder ? `${folder}/${file.name}` : file.name
  let targetPath = basePath
  let counter = 1
  while (app.vault.getAbstractFileByPath(targetPath)) {
    const dot = file.name.lastIndexOf('.')
    const name = dot > 0 ? file.name.slice(0, dot) : file.name
    const ext = dot > 0 ? file.name.slice(dot) : ''
    targetPath = folder ? `${folder}/${name} ${counter}${ext}` : `${name} ${counter}${ext}`
    counter++
  }

  const buffer = await file.arrayBuffer()
  return await app.vault.createBinary(targetPath, buffer)
}

export function getAttachmentIcon(path: string): string {
  if (isImagePath(path)) return 'image'
  const ext = path.split('.').pop()?.toLowerCase() || ''
  if (['md', 'txt', 'json', 'csv', 'xml', 'yaml', 'yml', 'toml'].includes(ext)) {
    return 'file-text'
  }
  return 'file'
}

export function fileName(path: string): string {
  return path.split('/').pop() || path
}
