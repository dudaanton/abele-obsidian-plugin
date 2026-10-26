// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { promises as nodeDisk } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { IDBFactory } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { TokenEngines } from '@/sync/tokenEngines'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'
import { nativeTokenFixture } from '../helpers/nativeTokenFixture'

// The costs below are per file, so a few thousand files show them; the upload dominates the run.
const FILES = Number(process.env.SYNCED_RESTART_FILES ?? 2000)
const INVENTORY_PASS = Symbol.for('abele.sync.inventory-pass-v1')

/** The adapter of a desktop vault: every call reaches the real disk under `root`. */
function nativeVault(root: string, disk: typeof import('node:fs').promises): FakeApp {
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
function countedDisk() {
  const calls = new Map<string, number>()
  const port = new Proxy(nodeDisk, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== 'function' || typeof key !== 'string') return value
      return (...args: unknown[]) => {
        calls.set(key, (calls.get(key) ?? 0) + 1)
        return Reflect.apply(value, target, args)
      }
    },
  })
  return { port, calls }
}

/** Counts the transactions every database opened through `factory` creates, by mode. */
function countTransactions(factory: IDBFactory) {
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

it(`restarts a synced ${FILES}-file native vault verifying each file about once`, async () => {
  const root = await nodeDisk.realpath(
    await nodeDisk.mkdtemp(join(tmpdir(), 'sample-synced-restart-'))
  )
  const server = await v2Server()
  const factory = new IDBFactory()
  const transactions = countTransactions(factory)
  const counted = countedDisk()
  const disk = counted.port
  desktopFsPort(disk)
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
  const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  vi.stubGlobal('document', { visibilityState: 'visible' })
  const paths = Array.from(
    { length: FILES },
    (_, i) => `Sample/Notes/Batch ${i % 40}/Sample ${i}.md`
  )
  let device: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  let restarted: TokenEngines | undefined
  const passes = vi.spyOn(
    ObsidianFileSystem.prototype as unknown as Record<symbol, () => Promise<unknown>>,
    INVENTORY_PASS
  )
  try {
    for (const folder of new Set(paths.map(dirname)))
      await nodeDisk.mkdir(join(root, folder), { recursive: true })
    for (let i = 0; i < paths.length; i += 64)
      await Promise.all(
        paths.slice(i, i + 64).map((path) => nodeDisk.writeFile(join(root, path), `sample ${path}`))
      )
    const app = nativeVault(root, disk)
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    const uploadStarted = performance.now()
    device = await nativeTokenFixture(app, user.token, globalThis.fetch, factory)
    const uploadMs = performance.now() - uploadStarted
    await device.host.close()
    passes.mockClear()
    counted.calls.clear()
    transactions.readonly = transactions.readwrite = 0
    const started = performance.now()
    restarted = new TokenEngines(
      app as unknown as App,
      device.ui,
      (reference) => device!.keys.get(reference) ?? null,
      {
        fetch: globalThis.fetch,
        indexedDB: factory,
        fallbackMs: 60000,
        pollMs: 60000,
        WebSocket: class {
          constructor() {
            throw new Error('Fixture uses polling')
          }
        } as never,
      },
      'Scripts',
      { path: `${app.vault.configDir}/plugins/abele/data.json`, arrived: () => {} }
    )
    restarted.start()
    await device.ui.connectionsChanged()
    await device.ui.sync(device.id)
    await vi.waitFor(
      () => {
        const row = device!.ui.rows.value.find((one) => one.id === device!.id)
        if (row?.status !== 'idle') throw new Error('Waiting for the restarted sync')
      },
      { timeout: 1_800_000, interval: 50 }
    )
    const idleMs = performance.now() - started
    const classification = device.ui.activity.value[device.id]?.classification
    console.log(
      'native synced restart',
      JSON.stringify({
        files: FILES,
        uploadMs,
        idleMs,
        inventoryPasses: passes.mock.calls.length,
        transactions: { ...transactions },
        native: Object.fromEntries(counted.calls),
        classification: classification && {
          loaded: classification.loaded,
          contentReads: classification.contentReads,
          callers: classification.callers,
        },
      })
    )
    expect(classification?.contentReads).toBe(0)
    // A synced restart verifies each file about once. The ledger walks of every cycle reuse
    // that proof while the watcher sees no change, so they add no disk or database round trip.
    // Before, every walk stated every file, each identity check re-verified the vault root and
    // every folder above the file, and two walks read the ledger once per file: about 50 lstat,
    // 6 realpath and 2 ledger transactions per file, and minutes at 33000 files.
    const verified = classification!.callers['state.all']
    expect(verified.hit ?? 0).toBeLessThanOrEqual(FILES * 2)
    expect(Object.keys(verified).sort()).toEqual(['hit', 'pass'])
    expect(counted.calls.get('lstat') ?? 0).toBeLessThanOrEqual(FILES * 12)
    expect(counted.calls.get('realpath') ?? 0).toBeLessThan(FILES / 4 + 300)
    expect(transactions.readonly).toBeLessThan(FILES / 4 + 300)
    // Alone it takes about two seconds at 2000 files; this only catches a collapse.
    expect(idleMs).toBeLessThan(FILES * 15)
  } finally {
    passes.mockRestore()
    await restarted?.close()
    await device?.host.close()
    await server.close()
    await nodeDisk.rm(root, { recursive: true, force: true })
    timers.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(window, key, previous[i]!)
      else Reflect.deleteProperty(window, key)
    })
    vi.unstubAllGlobals()
  }
}, 3_600_000)
