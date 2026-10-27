import { promises as nodeDisk } from 'node:fs'
import { dirname, join } from 'node:path'
import { IDBFactory } from 'fake-indexeddb'
import { buildFakeVault, type FakeApp } from './fakeVault'

/** The adapter of a desktop vault: every call reaches the real disk under `root`. */
export function nativeVault(root: string, disk: typeof import('node:fs').promises): FakeApp {
  const app = buildFakeVault([])
  const full = (path: string) => join(root, path)
  const missing = (error: unknown) => (error as { code?: string }).code === 'ENOENT'
  Object.assign(app.vault.adapter, {
    getFullPath: full,
    fsPromises: disk,
    exists: async (path: string) =>
      disk.lstat(full(path)).then(
        () => true,
        (error) => (missing(error) ? false : Promise.reject(error))
      ),
    stat: async (path: string) => {
      try {
        const value = await disk.stat(full(path))
        return {
          type: value.isDirectory() ? 'folder' : 'file',
          size: value.size,
          mtime: value.mtimeMs,
          ctime: value.birthtimeMs,
        }
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
    },
    list: async (path: string) => {
      const rows = await disk.readdir(full(path), { withFileTypes: true })
      const child = (name: string) => [path, name].filter(Boolean).join('/')
      return {
        files: rows.filter((row) => row.isFile()).map((row) => child(row.name)),
        folders: rows.filter((row) => row.isDirectory()).map((row) => child(row.name)),
      }
    },
    read: async (path: string) => disk.readFile(full(path), 'utf8'),
    readBinary: async (path: string) => {
      const bytes = await disk.readFile(full(path))
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
    write: async (path: string, data: string) => {
      await disk.mkdir(dirname(full(path)), { recursive: true })
      await disk.writeFile(full(path), data)
    },
    writeBinary: async (path: string, data: ArrayBuffer) => {
      await disk.mkdir(dirname(full(path)), { recursive: true })
      await disk.writeFile(full(path), new Uint8Array(data))
    },
    append: async (path: string, data: string) => disk.appendFile(full(path), data),
    mkdir: async (path: string) => {
      await disk.mkdir(full(path), { recursive: true })
    },
    remove: async (path: string) => disk.rm(full(path)),
    rmdir: async (path: string, recursive: boolean) =>
      recursive ? disk.rm(full(path), { recursive: true }) : disk.rmdir(full(path)),
    rename: async (from: string, to: string) => disk.rename(full(from), full(to)),
  })
  Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
  return app
}

/** The native promise port, counting each call by name. */
export function countedDisk(observeRead?: (path: string, bytes: number) => void) {
  const calls = new Map<string, number>()
  const port = new Proxy(nodeDisk, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== 'function' || typeof key !== 'string') return value
      return (...args: unknown[]) => {
        calls.set(key, (calls.get(key) ?? 0) + 1)
        const result = Reflect.apply(value, target, args)
        if (!observeRead) return result
        if (key === 'readFile')
          return Promise.resolve(result).then((bytes) => {
            observeRead(
              String(args[0]),
              typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength
            )
            return bytes
          })
        if (key === 'open')
          return Promise.resolve(result).then((handle: import('node:fs/promises').FileHandle) => {
            const read = handle.read.bind(handle)
            handle.read = (async (...values: Parameters<typeof read>) => {
              const result = await read(...values)
              observeRead(String(args[0]), result.bytesRead)
              return result
            }) as typeof handle.read
            return handle
          })
        return result
      }
    },
  })
  return { port, calls }
}

/** Counts the transactions every database opened through `factory` creates, by mode. */
export function countTransactions(factory: IDBFactory) {
  const counts = { readonly: 0, readwrite: 0 }
  const open = factory.open.bind(factory)
  factory.open = ((...args: Parameters<IDBFactory['open']>) => {
    const request = open(...args)
    request.addEventListener('success', () => {
      const db = request.result
      const transaction = db.transaction.bind(db)
      db.transaction = ((...values: Parameters<IDBDatabase['transaction']>) => {
        // The emulator keeps finished transactions as history; at scale that history
        // makes its scheduling quadratic. Live and queued transactions are kept.
        const raw = Reflect.get(db, '_rawDatabase') as { transactions: { _state: string }[] }
        raw.transactions = raw.transactions.filter((tx) => tx._state !== 'finished')
        counts[values[1] === 'readwrite' ? 'readwrite' : 'readonly']++
        return transaction(...values)
      }) as IDBDatabase['transaction']
    })
    return request
  }) as IDBFactory['open']
  return counts
}
