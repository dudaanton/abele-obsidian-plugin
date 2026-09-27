/**
 * Obsidian desktop's own hands on the disk, added to a fake vault's adapter.
 *
 * The desktop `FileSystemAdapter` holds Node's `fs.promises` as `fsPromises` and maps a vault
 * path onto the disk with `getFullPath`; the phone's adapter has neither. The fake adapter is
 * the phone's shape, so a test that means the desktop adds these two over the same disk:
 *
 * - `rename(2)` replaces a file standing at the destination, in one step;
 * - `rmdir(2)` removes an empty folder only, and refuses one holding anything (ENOTEMPTY).
 */
import type { FakeApp } from './fakeVault'

const ROOT = '/vault/'

export interface DesktopCalls {
  renames: [string, string][]
  rmdirs: string[]
}

export function withDesktopFs(app: FakeApp): DesktopCalls {
  const adapter = app.vault.adapter
  const calls: DesktopCalls = { renames: [], rmdirs: [] }
  const vaultPath = (full: string): string => {
    if (!full.startsWith(ROOT)) throw new Error(`ENOENT: outside the vault: ${full}`)
    return full.slice(ROOT.length)
  }
  Object.assign(adapter, {
    getFullPath: (path: string): string => ROOT + path,
    fsPromises: {
      async rename(fullFrom: string, fullTo: string): Promise<void> {
        const from = vaultPath(fullFrom)
        const to = vaultPath(fullTo)
        calls.renames.push([from, to])
        const standing = await adapter.stat(to)
        if (standing?.type === 'folder') throw new Error(`EISDIR: ${to}`)
        if (standing !== null) {
          // What `rename(2)` does in one step, done here in two with nothing in between.
          const bytes = await adapter.readBinary(from)
          const at = await adapter.stat(from)
          await adapter.remove(from)
          await adapter.writeBinary(to, bytes, { mtime: at?.mtime ?? 0, ctime: at?.ctime ?? 0 })
          return
        }
        await adapter.rename(from, to)
      },
      async rmdir(full: string): Promise<void> {
        const folder = vaultPath(full)
        calls.rmdirs.push(folder)
        const listed = await adapter.list(folder)
        if (listed.files.length > 0 || listed.folders.length > 0) {
          throw new Error(`ENOTEMPTY: directory not empty, rmdir '${full}'`)
        }
        await adapter.rmdir(folder, true)
      },
    },
  })
  return calls
}
