import { constants } from 'node:fs'
import { buildFakeVault } from './fakeVault'

/** Inode-bearing memory filesystem: native boundaries without disk or module loading. */
export function virtualNativeVault() {
  const app = buildFakeVault([])
  let serial = 1
  type Entry = { ino: number; bytes: Uint8Array; mtime: number; directory: boolean }
  const entries = new Map<string, Entry>()
  const failure = (code: string) => Object.assign(new Error(code), { code })
  const get = (path: string) => {
    const entry = entries.get(path)
    if (!entry) throw failure('ENOENT')
    return entry
  }
  const create = (path: string, directory = false) => {
    const entry = { ino: serial++, bytes: new Uint8Array(), mtime: 1000, directory }
    entries.set(path, entry)
    return entry
  }
  const info = (entry: Entry) => ({
    dev: 1,
    ino: entry.ino,
    size: entry.bytes.length,
    mtimeMs: entry.mtime,
    ctimeMs: entry.mtime,
    isDirectory: () => entry.directory,
    isFile: () => !entry.directory,
    isSymbolicLink: () => false,
  })
  create('', true)
  const native = {
    lstat: async (path: string) => info(get(path)),
    stat: async (path: string) => info(get(path)),
    mkdir: async (path: string) => {
      if (entries.has(path)) throw failure('EEXIST')
      create(path, true)
    },
    rename: async (from: string, to: string) => {
      const entry = get(from)
      entries.set(to, entry)
      entries.delete(from)
    },
    link: async (from: string, to: string) => {
      if (entries.has(to)) throw failure('EEXIST')
      entries.set(to, get(from))
    },
    unlink: async (path: string) => {
      get(path)
      entries.delete(path)
    },
    rmdir: async (path: string) => {
      if ([...entries.keys()].some((one) => one.startsWith(path + '/'))) throw failure('ENOTEMPTY')
      get(path)
      entries.delete(path)
    },
    readFile: async (path: string) => get(path).bytes.slice(),
    utimes: async (path: string, _atime: number, mtime: number) => {
      get(path).mtime = mtime * 1000
    },
    open: async (path: string, flags: string | number) => {
      const exclusive = typeof flags === 'number' ? !!(flags & constants.O_EXCL) : flags === 'wx'
      const creates = typeof flags === 'number' ? !!(flags & constants.O_CREAT) : flags === 'wx'
      if (exclusive && entries.has(path)) throw failure('EEXIST')
      const entry = creates && !entries.has(path) ? create(path) : get(path)
      return {
        stat: async () => info(entry),
        readFile: async () => entry.bytes.slice(),
        read: async (bytes: Uint8Array, offset: number, length: number, position: number) => {
          const part = entry.bytes.subarray(position, position + length)
          bytes.set(part, offset)
          return { bytesRead: part.length }
        },
        write: async (bytes: Uint8Array, offset: number, length: number, position: number) => {
          const next = new Uint8Array(Math.max(entry.bytes.length, position + length))
          next.set(entry.bytes)
          next.set(bytes.subarray(offset, offset + length), position)
          entry.bytes = next
          return { bytesWritten: length }
        },
        truncate: async (length: number) => {
          entry.bytes = entry.bytes.slice(0, length)
        },
        sync: async () => {},
        close: async () => {},
      }
    },
  }
  const root = 'sample-vault'
  for (const key of Object.keys(native)) {
    const original = Reflect.get(native, key)
    Reflect.set(native, key, (...args: unknown[]) =>
      original.apply(
        native,
        args.map((arg, n) =>
          n < (['rename', 'link'].includes(key) ? 2 : 1) && typeof arg === 'string'
            ? arg === root
              ? ''
              : arg.replace(root + '/', '')
            : arg
        )
      )
    )
  }
  const adapter = app.vault.adapter
  Object.assign(adapter, {
    fsPromises: native,
    getFullPath: (path: string) => root + (path ? '/' + path : ''),
    stat: async (path: string) => {
      const entry = entries.get(path)
      return entry
        ? {
            type: entry.directory ? 'folder' : 'file',
            size: entry.bytes.length,
            mtime: entry.mtime,
            ctime: entry.mtime,
          }
        : null
    },
    exists: async (path: string) => entries.has(path),
    mkdir: native.mkdir,
    rename: async (from: string, to: string) => {
      if (entries.has(to)) throw failure('EEXIST')
      await native.rename(from, to)
    },
    remove: native.unlink,
    rmdir: native.rmdir,
    writeBinary: async (path: string, bytes: ArrayBuffer, options?: { mtime?: number }) => {
      const entry = entries.get(path) ?? create(path)
      entry.bytes = new Uint8Array(bytes).slice()
      entry.mtime = options?.mtime ?? 1000
    },
    readBinary: async (path: string) => get(path).bytes.slice().buffer,
    list: async (path: string) => {
      const children = [...entries].filter(
        ([one]) => one !== path && one.slice(0, Math.max(0, one.lastIndexOf('/'))) === path
      )
      return {
        files: children.filter(([, entry]) => !entry.directory).map(([one]) => one),
        folders: children.filter(([, entry]) => entry.directory).map(([one]) => one),
      }
    },
  })
  return { app, native, entries }
}
