import { TFolder, type Vault } from 'obsidian'
import { ensureFolder } from './folders'
export { ensureFolder, type FolderHost } from './folders'

/** Thin Obsidian adapter; cancellation does not undo an already-admitted write. */
export function ensureVaultFolder(
  vault: Pick<Vault, 'getAbstractFileByPath' | 'createFolder'>,
  folder: string,
  signal?: AbortSignal
): Promise<void> {
  return ensureFolder(
    {
      folderExists: (path) => {
        const entry = vault.getAbstractFileByPath(path)
        if (entry && !(entry instanceof TFolder)) throw new Error(`Not a folder: ${path}`)
        return entry instanceof TFolder
      },
      createFolder: (path) => vault.createFolder(path),
    },
    folder,
    signal
  )
}
