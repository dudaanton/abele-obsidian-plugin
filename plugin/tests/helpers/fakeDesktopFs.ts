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

const nativeVolumes = new Map<string, WeakRef<object>>()
const desktopVolumes = new Proxy(
  {},
  {
    get(_target, method) {
      return (full: string, ...args: unknown[]) => {
        const root = '/' + full.split('/')[1] + '/'
        const port = nativeVolumes.get(root)?.deref()
        if (!port) throw Object.assign(new Error('missing native volume'), { code: 'ENOENT' })
        return Reflect.get(port, method).call(port, full, ...args)
      }
    },
  }
)

export interface DesktopCalls {
  renames: [string, string][]
  rmdirs: string[]
}

export function withDesktopFs(
  app: FakeApp,
  options: { fenced?: boolean; maxBufferBytes?: number; root?: string } = {}
): DesktopCalls {
  const ROOT = options.root ?? '/vault/'
  const adapter = app.vault.adapter
  const write = adapter.writeBinary.bind(adapter)
  const read = adapter.readBinary.bind(adapter)
  const rename = adapter.rename.bind(adapter)
  const remove = adapter.remove.bind(adapter)
  const identities = new Map<string, number>()
  let serial = 1
  const key = (path: string) => path.normalize('NFC').toLowerCase()
  const inode = (path: string) => {
    const name = key(path)
    if (!identities.has(name)) identities.set(name, serial++)
    return identities.get(name)!
  }
  adapter.rename = async (from, to) => {
    const identity = inode(from)
    await rename(from, to)
    identities.delete(key(from))
    identities.set(key(to), identity)
  }
  adapter.remove = async (path) => {
    await remove(path)
    identities.delete(key(path))
  }
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
          ino: inode(path),
          size: 'size' in stat ? stat.size : 0,
          mtimeMs: 'mtime' in stat ? stat.mtime : 0,
          ctimeMs: 'ctime' in stat ? stat.ctime : 0,
          isSymbolicLink: () => false,
          isDirectory: () => stat.type === 'folder',
          isFile: () => stat.type === 'file',
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
          stat: async () => ({ ...(await this.lstat(full)), ino: identity.ino }),
          readFile: async () => new Uint8Array(await read(path)),
          read: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            if (
              options.maxBufferBytes !== undefined &&
              buffer.buffer.byteLength > options.maxBufferBytes
            )
              throw new Error('Native read buffer exceeds the fixture bound')
            const bytes = new Uint8Array(await read(path)).subarray(position, position + length)
            buffer.set(bytes, offset)
            return { bytesRead: bytes.length }
          },
          write: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            if (
              options.maxBufferBytes !== undefined &&
              buffer.buffer.byteLength > options.maxBufferBytes
            )
              throw new Error('Native write buffer exceeds the fixture bound')
            const old = new Uint8Array(await read(path))
            const bytes = new Uint8Array(Math.max(old.length, position + length))
            bytes.set(old)
            bytes.set(buffer.subarray(offset, offset + length), position)
            await write(path, bytes.buffer)
            return { bytesWritten: length }
          },
          truncate: async (length: number) => {
            const old = new Uint8Array(await read(path))
            const bytes = new Uint8Array(length)
            bytes.set(old.subarray(0, length))
            await write(path, bytes.buffer)
          },
          sync: async () => {},
          utimes: async (_atime: number, mtime: number) =>
            write(path, await read(path), { mtime: mtime * 1000 }),
          close: async () => {},
        }
      },
      async readFile(path: string): Promise<Uint8Array> {
        return new Uint8Array(await read(vaultPath(path)))
      },
      async link(fullFrom: string, fullTo: string): Promise<void> {
        const from = vaultPath(fullFrom),
          to = vaultPath(fullTo)
        if (await adapter.exists(to))
          throw Object.assign(new Error(`EEXIST: ${to}`), { code: 'EEXIST' })
        const stat = await adapter.stat(from)
        await write(
          to,
          await read(from),
          stat ? { mtime: stat.mtime, ctime: stat.ctime } : undefined
        )
        identities.set(key(to), inode(from))
      },
      async rename(fullFrom: string, fullTo: string): Promise<void> {
        const from = vaultPath(fullFrom)
        const to = vaultPath(fullTo)
        calls.renames.push([from, to])
        const standing = await adapter.stat(to)
        if (standing?.type === 'folder') throw new Error(`EISDIR: ${to}`)
        if (standing !== null) {
          const source = await adapter.stat(from)
          if (source?.type === 'folder') throw new Error(`ENOTDIR: ${to}`)
          // Keep capture fault injection on the adapter rename boundary, including
          // replacement of the allocation sentinel.
          await adapter.remove(to)
        }
        await adapter.rename(from, to)
      },
      async rmdir(full: string): Promise<void> {
        const folder = vaultPath(full)
        calls.rmdirs.push(folder)
        const listed = await adapter.list(folder)
        if (listed.files.length > 0 || listed.folders.length > 0) {
          throw Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${full}'`), {
            code: 'ENOTEMPTY',
          })
        }
        await adapter.rmdir(folder, true)
      },
      async stat(full: string) {
        return this.lstat(full)
      },
      async utimes(full: string, _atime: number, mtime: number) {
        const path = vaultPath(full)
        await write(path, await read(path), { mtime: mtime * 1000 })
      },
    },
  })
  nativeVolumes.set(ROOT, new WeakRef(Reflect.get(adapter, 'fsPromises')))
  desktopFsPort(desktopVolumes)
  return calls
}
