/** Storage-independent folder creation; a file must never satisfy folderExists. */
export interface FolderHost {
  folderExists(path: string): boolean | Promise<boolean>
  createFolder(path: string): Promise<unknown>
}

/** Vault-relative path, parents first. Empty means root; errors remain the host's own. */
export async function ensureFolder(
  host: FolderHost,
  folder: string,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  const parts = folder.split('/').filter(Boolean)
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join('/')
    if (await host.folderExists(path)) continue
    signal?.throwIfAborted()
    try {
      await host.createFolder(path)
    } catch (error) {
      // Only ignore a concurrent creator, not an I/O failure or a file occupying the path.
      if (!(await host.folderExists(path))) throw error
    }
  }
}
