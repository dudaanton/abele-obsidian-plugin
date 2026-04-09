import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { nanoid } from 'nanoid'

/**
 * Get the vault's configured attachment folder path, ensuring it exists.
 */
export async function getAttachmentFolder(): Promise<string> {
  const { app } = GlobalStore.getInstance()
  let folder = (app.vault as any).getConfig?.('attachmentFolderPath') || 'Attachments'
  if (folder === '/' || folder === '.') folder = ''

  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder)
  }

  return folder
}

/**
 * Save a base64 data URL image to the vault attachments folder.
 * Returns the vault path of the saved file.
 */
export async function saveImageToVault(dataUrl: string, nameHint?: string): Promise<string> {
  const { app } = GlobalStore.getInstance()
  const folder = await getAttachmentFolder()

  // Parse data URL: data:image/png;base64,iVBOR...
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) throw new Error('Invalid image data URL')

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  const base64 = match[2]

  // Convert base64 to ArrayBuffer
  const raw = atob(base64)
  const buffer = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i)
  }

  const baseName = nameHint || `image-${nanoid(8)}`
  const basePath = folder ? `${folder}/${baseName}.${ext}` : `${baseName}.${ext}`

  // Avoid name collisions
  let targetPath = basePath
  let counter = 1
  while (app.vault.getAbstractFileByPath(targetPath)) {
    targetPath = folder
      ? `${folder}/${baseName} ${counter}.${ext}`
      : `${baseName} ${counter}.${ext}`
    counter++
  }

  await app.vault.createBinary(targetPath, buffer.buffer)
  return targetPath
}

/**
 * Read a vault image file as a base64 data URL.
 */
export async function readImageAsDataUrl(path: string): Promise<string> {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)

  const binary = await app.vault.readBinary(file)
  const bytes = new Uint8Array(binary)
  let raw = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    raw += String.fromCharCode(bytes[i])
  }

  const ext = file.extension.toLowerCase()
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  }
  const mime = mimeMap[ext] || 'image/png'
  return `data:${mime};base64,${btoa(raw)}`
}
