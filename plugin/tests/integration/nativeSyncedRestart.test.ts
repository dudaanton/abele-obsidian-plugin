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
import { nativeVault, countedDisk, countTransactions } from '../helpers/nativeRestartVault'
import { nativeTokenFixture } from '../helpers/nativeTokenFixture'
import { openTokenLedger } from '@/sync/tokenLedger'

// The costs below are per file, so a few thousand files show them; the upload dominates the run.
const FILES = Number(process.env.SYNCED_RESTART_FILES ?? 2000)
const INVENTORY_PASS = Symbol.for('abele.sync.inventory-pass-v1')

it(`restarts a synced ${FILES}-file native vault from its settled host index`, async () => {
  const root = await nodeDisk.realpath(
    await nodeDisk.mkdtemp(join(tmpdir(), 'sample-synced-restart-'))
  )
  const server = await v2Server()
  const factory = new IDBFactory()
  const transactions = countTransactions(factory)
  const fileProbes: string[] = []
  let countFileProbes = false
  const counted = countedDisk(undefined, undefined, (method, path) => {
    if (countFileProbes && ['lstat', 'stat', 'open', 'readFile'].includes(method) &&
        path.startsWith(join(root, 'Sample/Notes/Batch ')) && path.endsWith('.md'))
      fileProbes.push(`${method}:${path}`)
  })
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
    // A metadata-only update changes native status time while creation time stays put.
    // The settled host index reports creation time at its own precision.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await nodeDisk.utimes(join(root, paths[0]), new Date(1_600_000_000_000), new Date(1_600_000_000_000))
    const app = nativeVault(root, disk, paths)
    for (let i = 0; i < paths.length; i += 64)
      await Promise.all(
        paths.slice(i, i + 64).map(async (path) => {
          const stat = await nodeDisk.stat(join(root, path))
          const indexed = app.vault.getFileByPath(path)!
          indexed.stat = {
            size: stat.size,
            mtime: stat.mtimeMs,
            ctime: path === paths[0] ? stat.birthtimeMs + 0.25 : stat.birthtimeMs,
          }
          if (path === paths[0])
            expect(Math.abs(stat.ctimeMs - stat.birthtimeMs)).toBeGreaterThan(1)
        })
      )
    Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    const uploadStarted = performance.now()
    device = await nativeTokenFixture(app, user.token, globalThis.fetch, factory)
    const uploadMs = performance.now() - uploadStarted
    await device.host.close()
    const state = await openTokenLedger(factory, device.registry, device.registry.records()[0], () => {})
    try {
      const acknowledged = new Map(
        (await Array.fromAsync(state.all())).map((entry) => [entry.path, entry])
      )
      for (const path of paths)
        expect(acknowledged.get(path)?.ctime, `upload acknowledgement: ${path}`).toBeTypeOf('number')
    } finally {
      state.close()
    }
    passes.mockClear()
    counted.calls.clear()
    countFileProbes = true
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
    expect(classification?.callers['state.trust']?.hit).toBeGreaterThanOrEqual(FILES)
    expect(fileProbes).toEqual([])
    // A settled host row retains the last verified bytes. Ledger walks reuse that decision
    // while the watcher sees no change, so they add no per-file disk or database round trip.
    const verified = classification!.callers['state.all']
    expect(verified.hit ?? 0).toBeLessThanOrEqual(FILES * 2)
    // A settled indexed row now skips classification through the trusted read-only path.
    expect(Object.keys(verified).sort()).toEqual(['trusted'])
    // Directory and config checks have a fixed cost even in a tiny diagnostic vault.
    // The fileProbes assertion above is the per-file guarantee.
    expect(counted.calls.get('lstat') ?? 0).toBeLessThanOrEqual(FILES * 12 + 100)
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

it('restarts a normally downloaded native file without reading or probing its contents', async () => {
  const sourceRoot = await nodeDisk.realpath(await nodeDisk.mkdtemp(join(tmpdir(), 'sample-source-')))
  const targetRoot = await nodeDisk.realpath(await nodeDisk.mkdtemp(join(tmpdir(), 'sample-target-')))
  const server = await v2Server()
  const sourceFactory = new IDBFactory()
  const targetFactory = new IDBFactory()
  const path = 'Sample/Notes/Downloaded.md'
  const targetFile = join(targetRoot, path)
  const nativeCalls: string[] = []
  let counting = false
  const counted = countedDisk(undefined, undefined, (method, name) => {
    if (counting && name === targetFile && ['lstat', 'stat', 'open', 'readFile'].includes(method))
      nativeCalls.push(method)
  })
  desktopFsPort(counted.port)
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
  const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  vi.stubGlobal('document', { visibilityState: 'visible' })
  let source: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  let target: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  let restarted: TokenEngines | undefined
  try {
    await nodeDisk.mkdir(dirname(join(sourceRoot, path)), { recursive: true })
    await nodeDisk.writeFile(join(sourceRoot, path), 'sample peer content')
    const sourceApp = nativeVault(sourceRoot, counted.port, [path])
    const sourceStat = await nodeDisk.stat(join(sourceRoot, path))
    sourceApp.vault.getFileByPath(path)!.stat = {
      size: sourceStat.size, mtime: sourceStat.mtimeMs, ctime: sourceStat.birthtimeMs,
    }
    Object.assign(sourceApp.metadataCache, { initialized: true, isCacheClean: () => true })
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper }, 'Sample user', server.address
    )
    source = await nativeTokenFixture(sourceApp, user.token, globalThis.fetch, sourceFactory)
    await source.host.close()

    const targetApp = nativeVault(targetRoot, counted.port)
    Object.assign(targetApp.metadataCache, { initialized: true, isCacheClean: () => true })
    target = await nativeTokenFixture(targetApp, user.token, globalThis.fetch, targetFactory)
    expect(await nodeDisk.readFile(targetFile, 'utf8')).toBe('sample peer content')
    await target.host.close()
    const targetState = await openTokenLedger(
      targetFactory, target.registry, target.registry.records()[0], () => {}
    )
    try {
      expect((await targetState.get(path))?.ctime).toBeTypeOf('number')
    } finally {
      targetState.close()
    }
    // The test's host index catches up to the downloaded file before restart.
    await (targetApp.vault as typeof targetApp.vault & {
      create(path: string, content: string): Promise<unknown>
    }).create(path, 'sample peer content')
    const targetStat = await nodeDisk.stat(targetFile)
    targetApp.vault.getFileByPath(path)!.stat = {
      size: targetStat.size, mtime: targetStat.mtimeMs, ctime: targetStat.birthtimeMs,
    }
    counting = true
    restarted = new TokenEngines(
      targetApp as unknown as App, target.ui,
      (reference) => target!.keys.get(reference) ?? null,
      { fetch: globalThis.fetch, indexedDB: targetFactory, fallbackMs: 60000, pollMs: 60000,
        WebSocket: class { constructor() { throw new Error('Fixture uses polling') } } as never },
      'Scripts', { path: `${targetApp.vault.configDir}/plugins/abele/data.json`, arrived: () => {} }
    )
    restarted.start()
    await target.ui.connectionsChanged()
    await target.ui.sync(target.id)
    await vi.waitFor(() => {
      const row = target!.ui.rows.value.find((one) => one.id === target!.id)
      if (row?.status !== 'idle') throw new Error('Waiting for downloaded restart')
    }, { timeout: 120000, interval: 50 })
    expect(target.ui.activity.value[target.id]?.classification?.contentReads).toBe(0)
    expect(nativeCalls).toEqual([])
  } finally {
    await restarted?.close()
    await target?.host.close()
    await source?.host.close()
    await server.close()
    await nodeDisk.rm(sourceRoot, { recursive: true, force: true })
    await nodeDisk.rm(targetRoot, { recursive: true, force: true })
    timers.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(window, key, previous[i]!)
      else Reflect.deleteProperty(window, key)
    })
    vi.unstubAllGlobals()
  }
}, 240000)
