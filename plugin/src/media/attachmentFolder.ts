import type { App } from 'obsidian'
import { ensureVaultFolder } from '@/helpers/vaultFolders'

/** Resolve Obsidian's attachment setting to a vault-relative folder (empty means vault root). */
export function resolveAttachmentFolder(setting: string, notePath?: string): string {
  if (setting === '/' || setting === '.' || setting === '') return ''
  if (!setting.startsWith('./')) return setting
  const parent = notePath?.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
  const subfolder = setting.slice(2)
  return parent && subfolder ? `${parent}/${subfolder}` : parent || subfolder
}

/** Filename is already chosen by the caller: no sanitizing, extension or collision suffix. */
export function attachmentPath(setting: string, filename: string, notePath?: string): string {
  const folder = resolveAttachmentFolder(setting, notePath)
  return folder ? `${folder}/${filename}` : filename
}

/** Without a source note, "same folder" is the vault root; ./sub resolves from that root. */
export function configuredAttachmentFolder(app: App, notePath?: string): string {
  const vault = app.vault as typeof app.vault & { getConfig?: (key: string) => string | null }
  return resolveAttachmentFolder(
    vault.getConfig?.('attachmentFolderPath') ?? 'Attachments',
    notePath
  )
}

/** Ensure the resolved folder exists before writing an attachment into it. */
export async function ensureAttachmentFolder(
  app: App,
  notePath?: string,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const folder = configuredAttachmentFolder(app, notePath)
  await ensureVaultFolder(app.vault, folder, signal)
  return folder
}
