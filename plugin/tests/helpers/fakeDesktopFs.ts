import { constants } from 'node:fs'
import { desktopFsPort } from './desktopRequire'
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

export function withDesktopFs(app: FakeApp, options: { fenced?: boolean } = {}): DesktopCalls {
  const adapter = app.vault.adapter
  const write = adapter.writeBinary.bind(adapter)
  let tail: Promise<unknown> = Promise.resolve()
  const queue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation)
    tail = result.catch(() => {})
    return result
  }
  if (options.fenced !== false) {
    Object.assign(adapter, { queue })
    adapter.writeBinary = (path, data, opts) => queue(() => write(path, data, opts))
  }
  const calls: DesktopCalls = { renames: [], rmdirs: [] }
  const vaultPath = (full: string): string => {
    if (full === ROOT.slice(0, -1)) return ''
    if (!full.startsWith(ROOT)) throw new Error(`ENOENT: outside the vault: ${full}`)
    return full.slice(ROOT.length)
  }
  Object.assign(adapter, {
    getFullPath: (path: string): string => ROOT + path,
    fsPromises: {
      async lstat(full: string) {
        const path = vaultPath(full),
          stat = path === '' ? { type: 'folder' } : await adapter.stat(path)
        if (!stat) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return {
          dev: 1,
          ino: [...path.normalize('NFC').toLowerCase()].reduce(
            (id, char) => (id * 31 + char.charCodeAt(0)) >>> 0,
            1
          ),
          isSymbolicLink: () => false,
          isDirectory: () => stat.type === 'folder',
        }
      },
      async open(full: string, flags: number) {
        const path = vaultPath(full)
        const before = await adapter.stat(path)
        if (flags & constants.O_EXCL && before)
          throw Object.assign(new Error('exists'), { code: 'EEXIST' })
        if (!before && !(flags & constants.O_CREAT))
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        if (!before || flags & constants.O_TRUNC) await write(path, new ArrayBuffer(0))
        const identity = await this.lstat(full)
        return {
          stat: async () => identity,
          readFile: async () => new Uint8Array(await adapter.readBinary(path)),
          read: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            const bytes = new Uint8Array(await adapter.readBinary(path)).subarray(
              position,
              position + length
            )
            buffer.set(bytes, offset)
            return { bytesRead: bytes.length }
          },
          write: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            const old = new Uint8Array(await adapter.readBinary(path))
            const bytes = new Uint8Array(Math.max(old.length, position + length))
            bytes.set(old)
            bytes.set(buffer.subarray(offset, offset + length), position)
            await write(path, bytes.buffer)
            return { bytesWritten: length }
          },
          truncate: async (length: number) => {
            const old = new Uint8Array(await adapter.readBinary(path))
            const bytes = new Uint8Array(length)
            bytes.set(old.subarray(0, length))
            await write(path, bytes.buffer)
          },
          sync: async () => {},
          close: async () => {},
        }
      },
      async readFile(path: string): Promise<Uint8Array> {
        return new Uint8Array(await adapter.readBinary(vaultPath(path)))
      },
      async link(fullFrom: string, fullTo: string): Promise<void> {
        const from = vaultPath(fullFrom),
          to = vaultPath(fullTo)
        if (await adapter.exists(to))
          throw Object.assign(new Error(`EEXIST: ${to}`), { code: 'EEXIST' })
        await write(to, await adapter.readBinary(from))
      },
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
          await write(to, bytes, { mtime: at?.mtime ?? 0, ctime: at?.ctime ?? 0 })
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
  desktopFsPort(Reflect.get(adapter, 'fsPromises'))
  return calls
}
