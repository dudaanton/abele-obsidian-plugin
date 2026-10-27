// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { TokenEngines } from '@/sync/tokenEngines'
import { openTokenLedger } from '@/sync/tokenLedger'
import { tokenHostFixture } from '../helpers/tokenHostFixture'
import { nativeVault, countedDisk, countTransactions } from '../helpers/nativeRestartVault'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { scopeKey } from '@/sync/scope'
import { defaultSelective } from '@/sync/connection'
import { projectionInspectionIdentity } from '@/sync/external/inspectionIdentity'
import { withMetadataInventory } from '@/sync/vaultPathLinks'
import { ExchangeTrace } from '@/sync/exchangeTrace'

type Measurement = {
  idleMs: number
  firstRequestMs: number
  classification:
    | { contentReads: number; callers: Record<string, Record<string, number>> }
    | undefined
  cycles: string[]
  ordinaryBytes: number
  polledBytes: number
}
const results: Measurement[] = []
let measured: Promise<void> | undefined
const ensureMeasured = () => (measured ??= measure())

async function measure() {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-live-restart-')))
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
  const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  vi.stubGlobal('document', { visibilityState: 'visible' })
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  let ordinaryBytes = 0,
    polledBytes = 0
  const ordinaryPaths = new Set<string>()
  const polledPath = join(root, '.obsidian/sample.json')
  const counted = countedDisk((path, bytes) => {
    if (ordinaryPaths.has(path)) ordinaryBytes += bytes
    if (path === polledPath) polledBytes += bytes
  })
  desktopFsPort(counted.port)
  const requests: number[] = []
  const scope = { kind: 'folder', id: 'sample-root', path: '/' }
  const transport: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    if (['/v2/connection', '/v2/changes', '/v2/manifest'].includes(path))
      requests.push(performance.now())
    if (path === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'sample-token',
        space_id: 'sample-space',
        scope,
        status: 'active',
        limits: { max_file_bytes: 1000000, quota_bytes: null },
      })
    if (path === '/v2/changes' || path === '/v2/manifest')
      return Response.json({ items: [], cursor: 1, next: null })
    if (path === '/v2/connection/items') return new Response(null, { status: 404 })
    if (path === '/v2/commit') {
      const ops = JSON.parse(String(init?.body)).ops as {
        op: string
        path: string
        mtime: number
      }[]
      expect(ops.every((op) => op.op === 'mkdir')).toBe(true)
      return Response.json({
        cursor: 1,
        results: ops.map((op) => ({
          status: 'applied',
          file_id: 'directory-' + op.path,
          version_id: 'sample-directory-version',
          seq: 1,
          path: op.path,
          sha: null,
          size: 0,
          mtime: op.mtime,
        })),
      })
    }
    throw new Error('Unexpected request: ' + path + ' ' + String(init?.body).slice(0, 1000))
  }
  const app = nativeVault(root, counted.port)
  const factory = new IDBFactory()
  const transactions = countTransactions(factory)
  const storage = await HostSyncStorage.open(factory, 'sample-vault', app)
  const f = tokenHostFixture(transport, [], { app, factory })
  let cycleReceipts: string[] | undefined
  const log = ExchangeTrace.prototype.log
  const trace = vi.spyOn(ExchangeTrace.prototype, 'log').mockImplementation(function (line) {
    if (line.startsWith('sync: cycle ')) cycleReceipts?.push(line)
    log.call(this, line)
  })
  const progress = setInterval(
    () =>
      console.log(
        'native restart progress',
        requests.length,
        Object.fromEntries(counted.calls),
        f.ui.rows.value.map((row) => ({ status: row.status, error: row.error }))
      ),
    10000
  )
  let host: TokenEngines | undefined
  try {
    const paths = Array.from(
      { length: 33000 },
      (_, i) => `Sample/Section ${i % 40}/Nested/sample-${i}.md`
    )
    // Include a genuinely polled configuration path in the same ledger.
    paths[16000] = '.obsidian/sample.json'
    for (const path of paths)
      if (path !== '.obsidian/sample.json') ordinaryPaths.add(join(root, path))
    for (const folder of new Set(paths.map(dirname)))
      await disk.mkdir(join(root, folder), { recursive: true })
    const bytes = new Uint8Array([37])
    const hash = await sha256(bytes)
    for (let i = 0; i < paths.length; i += 64)
      await Promise.all(
        paths.slice(i, i + 64).map((path) => disk.writeFile(join(root, path), bytes))
      )
    const state = await openTokenLedger(f.factory, f.registry, f.registry.records()[0], () => {})
    await state.transaction(async (tx) => {
      for (const path of paths) {
        const stat = await disk.stat(join(root, path))
        await tx.put({
          path,
          wirePath: path,
          fileId: path,
          versionId: 'sample-version',
          sha: hash,
          size: bytes.length,
          mtime: Math.round(stat.mtimeMs),
        })
      }
      await tx.setCursor(1)
    })
    const selective = f.registry.records()[0].selective ?? defaultSelective()
    await state.setMeta('scope', await scopeKey(selective, null))
    await state.setMeta('marked-scope', JSON.stringify({ selective, scriptsFolder: 'Scripts' }))
    const filesystem = new ObsidianFileSystem(app as never, { ledger: state })
    const directories = await Array.fromAsync(filesystem.listDirectories())
    await state.setMeta(
      'v2-directories',
      JSON.stringify({
        directories: directories.map((dir) => ({
          ...dir,
          file_id: 'directory-' + dir.path,
          version_id: 'sample-directory-version',
          kind: 'directory',
        })),
        removals: [],
      })
    )
    await withMetadataInventory(app.vault, async () => {
      const entries = []
      for (const path of paths) {
        const identity = await projectionInspectionIdentity(app as never, path)
        expect(identity).not.toBeNull()
        entries.push({ ...identity!, path, marker: false })
        const stat = await disk.stat(join(root, path))
        await storage.writeScanFingerprint(filesystem.pathKey(path), {
          identity: identity!.identity!,
          sha: hash,
          size: stat.size,
          mtime: stat.mtimeMs,
          ctime: stat.birthtimeMs,
        })
      }
      await storage.writeInspections(entries)
    })
    state.close()
    await storage.flush()
    const open = () =>
      new TokenEngines(f.app as never, f.ui, (key) => f.keys.get(key) ?? null, {
        fetch: transport,
        indexedDB: f.factory,
        pollMs: 60000,
        fallbackMs: 60000,
        WebSocket: class {
          constructor() {
            throw new Error('Fixture uses polling')
          }
        } as never,
      })
    const measurements = []
    for (let generation = 0; generation < 2; generation++) {
      requests.length = 0
      ordinaryBytes = polledBytes = 0
      counted.calls.clear()
      transactions.readonly = transactions.readwrite = 0
      const started = performance.now()
      host = open()
      cycleReceipts = []
      host.start()
      await f.ui.connectionsChanged()
      // Observe start's own exchange; an explicit Sync now here would add an extra cycle
      // that is absent from the restart/foreground sequence being reproduced.
      await vi.waitFor(
        () => {
          const runtime = Reflect.get(host!, 'live').get(f.id)
          expect(runtime?.engine.status.state).toBe('idle')
          expect(runtime?.engine.status.lastSyncAt).toBeTruthy()
        },
        { timeout: 120000, interval: 10 }
      )
      // The foreground event that follows startup used to invalidate the just-proven tree.
      await host.foreground(true)
      measurements.push({
        idleMs: performance.now() - started,
        firstRequestMs: requests[0] - started,
        native: Object.fromEntries(counted.calls),
        transactions: { ...transactions },
        classification: f.ui.activity.value[f.id]?.classification,
        cycles: cycleReceipts,
        ordinaryBytes,
        polledBytes,
      })
      cycleReceipts = undefined
      await host.close()
    }
    console.log('native live restart', JSON.stringify(measurements))
    results.push(...measurements)
    // Positive controls keep a disconnected observer from making a zero-read result pass.
    const beforeRead = ordinaryBytes
    await counted.port.readFile(join(root, paths[0]))
    expect(ordinaryBytes).toBe(beforeRead + bytes.length)
    const beforePolledRead = polledBytes
    const handle = await counted.port.open(polledPath, 'r')
    try {
      await handle.read(new Uint8Array(bytes.length), 0, bytes.length, 0)
    } finally {
      await handle.close()
    }
    expect(polledBytes).toBe(beforePolledRead + bytes.length)
  } finally {
    trace.mockRestore()
    clearInterval(progress)
    await host?.close()
    await f.host.close()
    await storage.flush()
    storage.close()
    await disk.rm(root, { recursive: true, force: true })
    timers.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(window, key, previous[i]!)
      else Reflect.deleteProperty(window, key)
    })
    vi.unstubAllGlobals()
  }
}

it('keeps 33000 files content-read-free through startup, inspection and rebuild and asks the server promptly', async () => {
  await ensureMeasured()
  expect(results).toHaveLength(2)
  for (const result of results) {
    expect(result.firstRequestMs).toBeLessThan(2000)
    expect(result.classification?.contentReads).toBe(0)
    expect(result.ordinaryBytes).toBe(0)
    expect(result.polledBytes).toBe(0)
    expect(result.cycles).toHaveLength(2)
    expect(result.cycles[0]).toContain('start')
    expect(result.cycles[1]).toContain('inspect')
  }
}, 240000)

// BUG: The full host composition still spends too long walking an unchanged ledger.
it.fails(
  'settles a 33000-file host restart and inspection within ten seconds with one verification per path',
  async () => {
    await ensureMeasured()
    for (const result of results) {
      expect(result.idleMs).toBeLessThan(10000)
      expect(result.classification!.callers['state.all']?.hit ?? 0).toBeLessThanOrEqual(33008)
    }
  },
  240000
)
