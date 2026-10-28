// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { performance as nodePerformance } from 'node:perf_hooks'
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
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ExternalRepresentation } from '@/sync/external/representation'
import {
  SyncStartupTimeline,
  timedSyncTransport,
  type SyncStartupMark,
} from '@/sync/startupTimeline'

// Elapsed union of outstanding operations, not their overlapping sum. These are
// wait envelopes; CPU and callbacks may run while another operation is pending.
function waitEnvelope() {
  let pending = 0,
    since = 0,
    elapsed = 0
  return {
    begin() {
      if (pending++ === 0) since = performance.now()
      let done = false
      return () => {
        if (done) return
        done = true
        if (--pending === 0) elapsed += performance.now() - since
      }
    },
    read: () => elapsed + (pending ? performance.now() - since : 0),
  }
}

type Measurement = {
  idleMs: number
  firstRequestMs: number
  classification:
    | { contentReads: number; callers: Record<string, Record<string, number>> }
    | undefined
  cycles: string[]
  ordinaryBytes: number
  polledBytes: number
  beforeRequest: number
  inspectionReads: number
  inspectionReadsBeforeRequest: number
  indexedFileProbes: number
  walks: { phase: string; caller: string; rows: number }[]
  interrupted: boolean
  timeline: SyncStartupMark[]
  native: Record<string, number>
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
  const paths = Array.from(
    { length: 33000 },
    (_, i) => `Sample/Section ${i % 40}/Nested/sample-${i}.md`
  )
  paths[16000] = '.obsidian/sample.json'
  const ordinaryPaths = new Set<string>()
  const polledPath = join(root, '.obsidian/sample.json')
  const diskWait = waitEnvelope(),
    idbWait = waitEnvelope()
  let indexedFileProbes = 0
  const counted = countedDisk(
    (path, bytes) => {
      if (ordinaryPaths.has(path)) ordinaryBytes += bytes
      if (path === polledPath) polledBytes += bytes
    },
    diskWait.begin,
    (method, path) => {
      if (ordinaryPaths.has(path) && ['lstat', 'open', 'readFile'].includes(method)) {
        indexedFileProbes++
      }
    }
  )
  desktopFsPort(counted.port)
  const requests: number[] = []
  let suspendConnection: (() => void) | undefined
  const scope = { kind: 'folder', id: 'sample-root', path: '/' }
  const transport: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    if (['/v2/connection', '/v2/changes', '/v2/manifest'].includes(path))
      requests.push(performance.now())
    if (path === '/v2/connection' && suspendConnection) {
      const entered = suspendConnection
      suspendConnection = undefined
      entered()
      const signal = init?.signal
      await new Promise<void>((_, reject) => {
        const aborted = () => reject(new DOMException('Interrupted request', 'AbortError'))
        if (signal?.aborted) aborted()
        else signal?.addEventListener('abort', aborted, { once: true })
      })
    }
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
  const app = nativeVault(root, counted.port, paths)
  let indexClean = false
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => indexClean })
  const factory = new IDBFactory()
  const transactions = countTransactions(factory, idbWait.begin)
  const storage = await HostSyncStorage.open(factory, 'sample-vault', app)
  const inspectionReads = vi.spyOn(storage, 'readInspections')
  const f = tokenHostFixture(transport, [], { app, factory })
  let cycleReceipts: string[] | undefined
  let walks: { phase: string; caller: string; rows: number }[] = []
  let phase = 'setup',
    classifications = 0,
    beforeRequest = 0,
    inspectionReadsBeforeRequest = 0
  const classify = ExternalRepresentation.prototype.classify
  const classification = vi
    .spyOn(ExternalRepresentation.prototype, 'classify')
    .mockImplementation(function (...args) {
      classifications++
      return classify.apply(this, args)
    })
  const all = IndexedDbStateStore.prototype.all
  const ledger = vi.spyOn(IndexedDbStateStore.prototype, 'all').mockImplementation(function () {
    const walk = {
      phase,
      caller: new Error().stack?.split('\n').slice(2, 8).join(' <- ') ?? '',
      rows: 0,
    }
    walks.push(walk)
    const rows = all.call(this)
    return (async function* () {
      for await (const row of rows) {
        walk.rows++
        yield row
      }
    })()
  })
  const log = ExchangeTrace.prototype.log
  const trace = vi.spyOn(ExchangeTrace.prototype, 'log').mockImplementation(function (line) {
    if (line.startsWith('sync: cycle ')) {
      cycleReceipts?.push(line)
      phase = `cycle ${cycleReceipts?.length}`
    }
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
  let indexTimer: ReturnType<typeof setTimeout> | undefined
  try {
    // Exercise the parsed ignore policy on every nested file without excluding the
    // synced corpus. A missing rule makes the native fixture understate live path work.
    const ignoreText = '**/sample-absent-*.tmp\nSample/Section 39/Absent/**\n'
    // Include a genuinely polled configuration path in the same ledger.
    for (const path of paths)
      if (path !== '.obsidian/sample.json') ordinaryPaths.add(join(root, path))
    for (const folder of new Set(paths.map(dirname)))
      await disk.mkdir(join(root, folder), { recursive: true })
    await disk.writeFile(join(root, '.abele-sync-ignore'), ignoreText)
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
        const indexed = app.vault.getFileByPath(path)
        if (indexed)
          indexed.stat = {
            size: stat.size,
            mtime: stat.mtimeMs,
            ctime: stat.birthtimeMs,
          }
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
    await state.setMeta('scope', await scopeKey(selective, ignoreText))
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
    let timeline: SyncStartupTimeline
    const open = () =>
      new TokenEngines(f.app as never, f.ui, (key) => f.keys.get(key) ?? null, {
        fetch: timedSyncTransport(transport, timeline),
        startupTimeline: timeline,
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
      inspectionReads.mockClear()
      timeline = new SyncStartupTimeline()
      const marks: SyncStartupMark[] = []
      timeline.subscribe((mark) => marks.push(mark))
      timeline.mark('onload')
      timeline.mark('layout-ready')
      ordinaryBytes = polledBytes = 0
      indexedFileProbes = 0
      counted.calls.clear()
      transactions.readonly = transactions.readwrite = 0
      const started = performance.now()
      const cpu = process.cpuUsage(),
        diskBefore = diskWait.read(),
        idbBefore = idbWait.read()
      const eventLoop = nodePerformance.eventLoopUtilization()
      walks = []
      classifications = 0
      beforeRequest = 0
      inspectionReadsBeforeRequest = 0
      phase = 'startup'
      const first = requests.push.bind(requests)
      requests.push = (...times) => {
        if (!requests.length) {
          beforeRequest = classifications
          inspectionReadsBeforeRequest = inspectionReads.mock.calls.length
        }
        return first(...times)
      }
      indexClean = false
      host = open()
      // The host has indexed the vault, but its metadata cache finishes shortly after layout.
      indexTimer = setTimeout(() => {
        indexClean = true
        app.emit('metadataCache', 'resolved')
      }, 150)
      cycleReceipts = []
      const interrupted = generation === 0
      let entered: Promise<void> | undefined
      if (interrupted)
        entered = new Promise<void>((resolve) => {
          suspendConnection = resolve
        })
      host.start()
      await f.ui.connectionsChanged()
      if (entered) {
        await entered
        // Rebuild while the first useful server request is still in flight. Closing
        // must cancel it, drain old work and leave the durable ledger reusable.
        await Reflect.get(host, 'engines').reset()
        host.start()
        await f.ui.connectionsChanged()
      }
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
        cpuMs: Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b, 0) / 1000,
        eventLoop: nodePerformance.eventLoopUtilization(eventLoop),
        diskWaitMs: diskWait.read() - diskBefore,
        idbWaitMs: idbWait.read() - idbBefore,
        walks: walks.map((walk) => ({ ...walk })),
        beforeRequest,
        inspectionReads: inspectionReads.mock.calls.length,
        inspectionReadsBeforeRequest,
        indexedFileProbes,
        interrupted,
        timeline: marks,
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
      clearTimeout(indexTimer)
      indexTimer = undefined
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
    clearTimeout(indexTimer)
    trace.mockRestore()
    ledger.mockRestore()
    classification.mockRestore()
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
    expect(result.beforeRequest).toBe(0)
    expect(result.inspectionReadsBeforeRequest).toBe(0)
    if (!result.interrupted) expect(result.inspectionReads).toBeLessThanOrEqual(1)
    expect(result.classification?.contentReads).toBe(0)
    expect(result.classification?.callers.list?.pass ?? 0).toBeLessThanOrEqual(33000)
    expect(result.ordinaryBytes).toBe(0)
    expect(result.polledBytes).toBe(0)
    // The 33k unchanged indexed rows are trusted. Native probes are limited to
    // directories, hidden configuration and recovery artifacts.
    expect(result.native.lstat ?? 0).toBeLessThan(500)
    expect(result.native.open ?? 0).toBeLessThan(10)
    expect(result.inspectionReads).toBeLessThanOrEqual(1)
    const order = result.timeline.map((mark) => mark.phase)
    const before = (a: string, b: string) => {
      expect(order.indexOf(a), `${a} present`).toBeGreaterThanOrEqual(0)
      expect(order.indexOf(b), `${b} present`).toBeGreaterThanOrEqual(0)
      expect(order.indexOf(a), `${a} before ${b}`).toBeLessThan(order.indexOf(b))
    }
    before('layout-ready', 'connection:Flushing registry:begin')
    before('connection:Flushing registry:end', 'connection:Checking recovery records:begin')
    before('connection:Checking saved sync state:end', 'connection:Preparing file access:begin')
    before('connection:Preparing file access:end', 'engine-construct')
    before('engine-construct', 'reconcile-start')
    before('connection:Recovery plugin-metadata:begin', 'first-request')
    before('first-request', 'connection:Recovery plugin-metadata:end')
    before('connection:Recovery plugin-metadata:end', 'engine-construct')
    before('first-request', 'first-response')
    before('first-response', 'idle')
    before('reconcile:inventory:begin', 'reconcile:inventory:connection:begin')
    before('reconcile:inventory:connection:begin', 'reconcile:inventory:connection:end')
    before('reconcile:inventory:begin', 'reconcile:inventory:ledger-rows:begin')
    before('reconcile:inventory:ledger-rows:begin', 'reconcile:inventory:ledger-rows:end')
    before('reconcile:inventory:ledger-rows:end', 'reconcile:inventory:end')
    before('reconcile:server-head:end', 'reconcile:post-head:end')
    before('reconcile:post-head:end', 'reconcile:file-list:begin')
    before('reconcile:finish-pull:begin', 'reconcile:finish-pull:end')
    before('reconcile:finish-pull:end', 'reconcile:cycle:end')
    const at = (phase: string) => result.timeline.find((mark) => mark.phase === phase)!.elapsedMs
    expect(at('first-request') - at('layout-ready')).toBeLessThan(1000)
    expect(at('idle') - at('first-response')).toBeLessThan(10000)
    expect(result.cycles).toHaveLength(result.interrupted ? 2 : 1)
    for (const cycle of result.cycles) expect(cycle).toContain('start')
    for (let i = 1; i <= result.cycles.length; i++)
      expect(result.walks.filter((walk) => walk.phase === `cycle ${i}`).length).toBeLessThanOrEqual(
        8
      )
  }
}, 240000)

it.fails(
  'BUG: unchanged indexed files need no native probes during a restart cycle',
  async () => {
    await ensureMeasured()
    for (const result of results) expect(result.indexedFileProbes).toBe(0)
  },
  240000
)

it('settles a 33000-file host restart and inspection within ten seconds with one verification per path', async () => {
  await ensureMeasured()
  for (const result of results) {
    expect(result.idleMs).toBeLessThan(10000)
    expect(result.classification!.callers['state.all']?.hit ?? 0).toBeLessThanOrEqual(33008)
  }
}, 240000)
