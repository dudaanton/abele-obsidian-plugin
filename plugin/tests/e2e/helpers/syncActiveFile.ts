import type { App } from 'obsidian'

/** Restore fixture navigation without invoking unrelated native file actions. */
export async function restoreSyncActiveFile(
  app: Pick<App, 'vault' | 'workspace'>,
  path: string | null,
  phone: boolean
): Promise<void> {
  const file = path ? app.vault.getFileByPath(path) : null
  if (file && (!phone || file.extension === 'md')) await app.workspace.getLeaf(false).openFile(file)
}
