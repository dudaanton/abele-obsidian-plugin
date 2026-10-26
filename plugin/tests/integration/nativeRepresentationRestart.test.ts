// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IDBFactory } from 'fake-indexeddb'
import { expect, it } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { pluginRepresentation } from '@/sync/external/pluginRepresentation'
import { EXTERNAL_INSPECTION_KEY } from '@/sync/external/pluginSafety'
import { RuntimeFence } from '@/sync/external/recovery'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { buildFakeVault } from '../helpers/fakeVault'

// Discard only the emulator's finished transaction history, not live transactions.
function prune(db: IDBDatabase) {
  const transaction = db.transaction.bind(db)
  db.transaction = ((...args: Parameters<typeof transaction>) => {
    const raw = Reflect.get(db, '_rawDatabase') as { transactions: { _state: string }[] }
    raw.transactions = raw.transactions.filter((tx) => tx._state !== 'finished')
    return transaction(...args)
  }) as typeof transaction
}

it('restarts a synced 33000-file native representation without reading content', async () => {
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
  const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-representation-')))
  const factory = new IDBFactory()
  const local = new Map<string, unknown>()
  const paths = Array.from({ length: 33000 }, (_, i) => `Shared/sample-${i}.md`)
  const bytes = new Uint8Array(4096).fill(37)
  const sha = await sha256(bytes)
  let contentBytes = 0
  const native = {
    ...disk,
    open: async (...args: Parameters<typeof disk.open>) => {
      const handle = await disk.open(...args)
      const read = handle.read.bind(handle)
      handle.read = (async (...values: Parameters<typeof read>) => {
        const result = await read(...values)
        contentBytes += result.bytesRead
        return result
      }) as typeof handle.read
      return handle
    },
    readFile: async (...args: Parameters<typeof disk.readFile>) => {
      const value = await disk.readFile(...args)
      contentBytes += typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength
      return value
    },
  }
  desktopFsPort(native)
  const makeApp = () => {
    const app = buildFakeVault([])
    Object.assign(app, {
      loadLocalStorage: (key: string) => structuredClone(local.get(key) ?? null),
      saveLocalStorage: (key: string, value: unknown) => local.set(key, structuredClone(value)),
    })
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: native,
      stat: async (path: string) => {
        try {
          const value = await disk.stat(join(root, path))
          return {
            type: value.isDirectory() ? 'folder' : 'file',
            size: value.size,
            mtime: value.mtimeMs,
            ctime: value.birthtimeMs,
          }
        } catch (error) {
          if ((error as { code: string }).code === 'ENOENT') return null
          throw error
        }
      },
      readBinary: async (path: string) =>
        new Uint8Array(await native.readFile(join(root, path))).buffer,
      read: async (path: string) => String(await native.readFile(join(root, path))),
      list: async (path: string) => {
        const rows = await disk.readdir(join(root, path), { withFileTypes: true })
        return {
          files: rows
            .filter((row) => row.isFile())
            .map((row) => [path, row.name].filter(Boolean).join('/')),
          folders: rows
            .filter((row) => row.isDirectory())
            .map((row) => [path, row.name].filter(Boolean).join('/')),
        }
      },
    })
    Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
    return app
  }
  let state: IndexedDbStateStore | undefined
  let host: HostSyncStorage | undefined
  const binding = {
    endpoint: 'https://sync.example.invalid',
    vaultId: 'sample-vault',
    mode: 'personal' as const,
    principalId: 'sample-device',
    principalType: 'device' as const,
    grantId: null,
    generation: 1,
    credentialAssociation: 'sample-slot',
  }
  // A synced restart lists the vault through several scans in one inventory pass.
  const open = async (expected = paths.length, listings = 1) => {
    const app = makeApp()
    host = await HostSyncStorage.open(factory, 'sample-vault', app)
    prune(Reflect.get(host, 'db'))
    state = await IndexedDbStateStore.open(factory, 'sample-restart')
    prune(Reflect.get(Reflect.get(state, 'connection'), 'db'))
    const fs = new ObsidianFileSystem(app as never, { ledger: state })
    const fence = new RuntimeFence(app, 'sample-restart', () => true)
    fence.activate()
    const placement = new LocalFolderPlacement('Shared', 'Shared')
    const representation = await pluginRepresentation({
      app: app as never,
      factory,
      store: state,
      ledgerId: 'sample-ledger',
      binding,
      fence,
      fs: placement.fileSystem(fs),
      placement,
      scriptsFolder: () => 'Scripts',
      verify: async () => {
        throw new Error('unexpected external verification')
      },
    })
    const list = async () => {
      let inspected = 0
      for await (const _ of representation.fileSystem().list()) inspected++
      expect(inspected).toBe(expected)
    }
    if (listings === 1) await list()
    else
      await Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).call(fs, async () => {
        for (let i = 0; i < listings; i++) await list()
      })
    return representation.classificationStats()
  }
  try {
    await disk.mkdir(join(root, 'Shared'))
    for (let i = 0; i < paths.length; i += 64)
      await Promise.all(
        paths.slice(i, i + 64).map((path) => disk.writeFile(join(root, path), bytes))
      )
    state = await IndexedDbStateStore.open(factory, 'sample-restart')
    prune(Reflect.get(Reflect.get(state, 'connection'), 'db'))
    await state.transaction(async (tx) => {
      for (const path of paths) {
        const info = await disk.stat(join(root, path))
        await tx.put({
          path,
          wirePath: path,
          fileId: path,
          versionId: 'sample-v1',
          sha,
          size: bytes.length,
          mtime: Math.floor(info.mtimeMs),
        })
      }
      await tx.setCursor(1)
    })
    state.close()
    await open()
    await host!.flush()
    host!.close()
    state!.close()
    contentBytes = 0
    const started = performance.now()
    const stats = await open(paths.length, 15)
    const idleMs = performance.now() - started
    console.log('native synced representation restart', {
      files: paths.length,
      listings: 15,
      contentBytes,
      idleMs,
      callers: stats.callers,
    })
    expect(contentBytes).toBe(0)
    expect(stats.contentReads).toBe(0)
    expect(await state!.getCursor()).toBe(1)
    // Fifteen listings cost about one: an unchanged file is verified against the cache once
    // per pass and every later listing in that pass reuses the proof. These counts are the
    // regression oracle; they do not depend on how busy the machine is.
    expect(stats.callers).toEqual({
      list: { hit: paths.length, pass: paths.length * 14 },
    })
    // Alone this takes about 25 s. The bound only catches a collapse, not a busy machine.
    expect(idleMs).toBeLessThan(90000)
    await host!.flush()
    host!.close()
    state!.close()
    await disk.rm(join(root, paths[0]))
    await open(paths.length - 1)
    // The cache lives in the host database: the host's local storage cannot hold 33000 rows.
    expect(local.has(EXTERNAL_INSPECTION_KEY)).toBe(false)
    expect(await host!.readInspections()).toHaveLength(paths.length - 1)
  } finally {
    host?.close()
    state?.close()
    await disk.rm(root, { recursive: true, force: true })
    timers.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(window, key, previous[i]!)
      else Reflect.deleteProperty(window, key)
    })
  }
}, 600000)
