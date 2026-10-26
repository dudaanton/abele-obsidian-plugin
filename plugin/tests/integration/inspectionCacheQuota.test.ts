// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { pluginRepresentation } from '@/sync/external/pluginRepresentation'
import { EXTERNAL_INSPECTION_KEY } from '@/sync/external/pluginSafety'
import { RuntimeFence } from '@/sync/external/recovery'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import type { ExternalRepresentation } from '@/sync/external/representation'
import { buildFakeVault } from '../helpers/fakeVault'

// The host's local storage has a small per-origin quota and drops a value that does not fit
// without saying so. A cache sized for a large vault must not depend on it.
const QUOTA = 64 * 1024
const FILES = 1200

let root: string
let factory: IDBFactory
let local: Map<string, string>
let contentBytes: number
const paths = Array.from({ length: FILES }, (_, i) => `Shared/Notes/sample-note-${i}.md`)
const handles: { close(): void }[] = []
const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
let previous: (PropertyDescriptor | undefined)[] = []

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

function makeApp() {
  const app = buildFakeVault([])
  const used = () => [...local].reduce((sum, [key, value]) => sum + key.length + value.length, 0)
  Object.assign(app, {
    loadLocalStorage: (key: string) => {
      const value = local.get(key)
      return value === undefined ? null : JSON.parse(value)
    },
    saveLocalStorage: (key: string, value: unknown) => {
      if (value == null) {
        local.delete(key)
        return
      }
      const text = JSON.stringify(value)
      const before = local.get(key)
      if (
        used() -
          (before === undefined ? 0 : key.length + before.length) +
          key.length +
          text.length >
        QUOTA
      )
        return
      local.set(key, text)
    },
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
        files: rows.filter((row) => row.isFile()).map((row) => [path, row.name].join('/')),
        folders: rows.filter((row) => row.isDirectory()).map((row) => [path, row.name].join('/')),
      }
    },
  })
  Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
  return app
}

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

/** One app start: host storage, ledger and representation, then one full listing. */
async function start(): Promise<ExternalRepresentation> {
  const app = makeApp()
  const host = await HostSyncStorage.open(factory, 'sample-vault', app)
  const state = await IndexedDbStateStore.open(factory, 'sample-restart')
  handles.push(host, state)
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
  let listed = 0
  for await (const _ of representation.fileSystem().list()) listed++
  expect(listed).toBe(FILES)
  return representation
}

function stop(): void {
  for (const handle of handles.splice(0)) handle.close()
}

beforeEach(async () => {
  previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-quota-')))
  factory = new IDBFactory()
  local = new Map()
  contentBytes = 0
  desktopFsPort(native)
  await disk.mkdir(join(root, 'Shared/Notes'), { recursive: true })
  const bytes = new TextEncoder().encode('# Sample note\n\nOrdinary text.\n')
  for (const path of paths) await disk.writeFile(join(root, path), bytes)
  const sha = await sha256(bytes)
  const state = await IndexedDbStateStore.open(factory, 'sample-restart')
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
})

afterEach(async () => {
  stop()
  await disk.rm(root, { recursive: true, force: true })
  timers.forEach((key, i) => {
    if (previous[i]) Object.defineProperty(window, key, previous[i]!)
    else Reflect.deleteProperty(window, key)
  })
})

it('restarts without reading content when the classification cache exceeds the host local-storage quota', async () => {
  await start()
  expect(contentBytes).toBeGreaterThan(0)
  stop()
  contentBytes = 0
  await start()
  expect(contentBytes).toBe(0)
})

it('moves an earlier local-storage cache into durable host storage and frees the local entry', async () => {
  await start()
  stop()
  // An earlier version kept the cache in local storage. Put a complete copy back there.
  const host = await HostSyncStorage.open(factory, 'sample-vault', makeApp())
  const entries = await host.readInspections()
  host.close()
  expect(entries).toHaveLength(FILES)
  local.clear()
  local.set(EXTERNAL_INSPECTION_KEY, JSON.stringify({ schema: 1, entries: entries.slice(0, 100) }))
  contentBytes = 0
  await start()
  expect(contentBytes).toBe(0)
  expect(local.has(EXTERNAL_INSPECTION_KEY)).toBe(false)
})

it('reports cache hits and the reason for every classification read by caller', async () => {
  const first = await start()
  const cold = first.classificationStats()
  expect(cold.callers.list?.['miss-absent']).toBe(FILES)
  expect(cold.contentReads).toBe(FILES)
  expect(cold.storage).toBe('host')
  stop()
  const second = await start()
  const warm = second.classificationStats()
  expect(warm.loaded).toBe(FILES)
  expect(warm.callers.list?.hit).toBe(FILES)
  expect(warm.contentReads).toBe(0)
  expect(warm.contentBytes).toBe(0)
  // The engine also walks the ledger through the representation; those checks hit too.
  let entries = 0
  for await (const _ of second.stateStore().all()) entries++
  expect(entries).toBe(FILES)
  expect(second.classificationStats().callers['state.all']?.hit).toBe(FILES)
  expect(second.classificationStats().contentReads).toBe(0)
  // A changed file names the field that differed.
  await disk.appendFile(join(root, paths[0]), 'more text\n')
  for await (const _ of second.fileSystem().list());
  const changed = second.classificationStats()
  expect(changed.callers.list?.['miss-changed:size']).toBe(1)
  expect(changed.contentReads).toBe(1)
})

it('keeps listing when a host without the sync database cannot store the cache', async () => {
  const app = makeApp()
  const state = await IndexedDbStateStore.open(factory, 'sample-restart')
  handles.push(state)
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
  let listed = 0
  for await (const _ of representation.fileSystem().list()) listed++
  expect(listed).toBe(FILES)
  const stats = representation.classificationStats()
  expect(stats.storage).toBe('local')
  // The value does not fit and the host drops it; the failure is counted, not thrown.
  expect(stats.persistFailures).toBe(1)
  expect(local.has(EXTERNAL_INSPECTION_KEY)).toBe(false)
})
