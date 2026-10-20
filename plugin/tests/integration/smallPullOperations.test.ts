// @vitest-environment node
import '../helpers/desktopRequire'
import { expect, it, vi } from 'vitest'
import { promises as native } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ExpectedWrites,
  MemoryStateStore,
  V2EngineClient,
  receiveToStage,
  sha256,
} from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import { PullPlacer } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullPlace.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'
import { JOURNAL_KEY } from '@/sync/writeJournal'
import { buildFakeVault } from '../helpers/fakeVault'
import {
  assertPullEvidence,
  assertSmallPullBounds,
  smallPullCounts,
} from '../helpers/smallPullBounds'
import { emptyPullSummary, summarizePull } from '@/sync/pullOperationCounts'
import { connectionAdapter } from '@/sync/connectionScope'
import { ExchangeTrace } from '@/sync/exchangeTrace'

async function measure(
  desktop: boolean,
  baseline: boolean | 'chunk-stage',
  count: number,
  isolateTransport = false,
  diagnostics = true,
  folder = false
) {
  const root = await native.mkdtemp(join(tmpdir(), 'sample-pull-'))
  const trace = isolateTransport && diagnostics ? new ExchangeTrace() : null
  const quiet = isolateTransport ? vi.spyOn(console, 'debug').mockImplementation(() => {}) : null
  const nativeCalls: string[] = []
  const nativeCall = <T>(operation: string, work: () => T): T => {
    nativeCalls.push(operation)
    return work()
  }
  const counts = {
    requests: 0,
    writes: 0,
    adapterWrites: 0,
    nativeWrites: 0,
    renames: 0,
    links: 0,
    journal: 0,
    flush: 0,
    opens: 0,
    reads: 0,
    indexWaits: 0,
    indexReconciles: 0,
    saveQueue: 0,
    bridge: 0,
  }
  const app = buildFakeVault([])
  const bytes = new Uint8Array(8203).fill(17),
    sha = await sha256(bytes)
  const path = (name: string) => join(root, name)
  const stat = async (name: string) => {
    try {
      const value = await nativeCall('stat', () => native.stat(path(name)))
      return {
        type: value.isFile() ? 'file' : 'folder',
        size: value.size,
        mtime: value.mtimeMs,
        ctime: value.ctimeMs,
      }
    } catch (error) {
      if ((error as { code: string }).code === 'ENOENT') return null
      throw error
    }
  }
  const write = async (name: string, data: ArrayBuffer, options?: { mtime?: number }) => {
    counts.writes++
    counts.adapterWrites++
    await nativeCall('writeFile', () => native.writeFile(path(name), new Uint8Array(data)))
    if (options?.mtime !== undefined)
      await nativeCall('utimes', () =>
        native.utimes(path(name), options.mtime! / 1000, options.mtime! / 1000)
      )
  }
  const rename = async (from: string, to: string) => {
    counts.renames++
    await nativeCall('rename', () => native.rename(from, to))
  }
  Object.assign(app.vault.adapter, {
    stat,
    exists: async (name: string) => (await stat(name)) !== null,
    mkdir: async (name: string) => {
      await nativeCall('mkdir', () => native.mkdir(path(name), { recursive: true }))
    },
    list: async () => ({ files: [], folders: [] }),
    writeBinary: write,
    appendBinary: async (name: string, data: ArrayBuffer) => {
      counts.writes++
      counts.adapterWrites++
      await native.appendFile(path(name), new Uint8Array(data))
    },
    readBinary: async (name: string) => {
      counts.reads++
      const data = await native.readFile(path(name))
      return Uint8Array.from(data).buffer
    },
    rename: (from: string, to: string) => rename(path(from), path(to)),
    remove: (name: string) => nativeCall('unlink', () => native.unlink(path(name))),
    ...(desktop
      ? {
          getFullPath: path,
          reconcileInternalFile: async () => {
            counts.indexReconciles++
          },
          queue: async <T>(work: () => Promise<T>) => {
            counts.saveQueue++
            return work()
          },
          fsPromises: {
            ...native,
            utimes: (...args: Parameters<typeof native.utimes>) =>
              nativeCall('utimes', () => native.utimes(...args)),
            rename,
            link: async (from: string, to: string) => {
              counts.links++
              await native.link(from, to)
            },
            open: async (name: string, flags: string) => {
              counts.opens++
              if (flags.includes('w')) {
                counts.writes++
                counts.nativeWrites++
              }
              const handle = await nativeCall('open ' + flags, () => native.open(name, flags))
              return {
                read: (...args: Parameters<typeof handle.read>) => {
                  counts.reads++
                  return nativeCall('read', () => handle.read(...args))
                },
                write: (...args: Parameters<typeof handle.write>) => {
                  counts.writes++
                  counts.nativeWrites++
                  return nativeCall('write', () => handle.write(...args))
                },
                sync: async () => {
                  counts.flush++
                  await nativeCall('fsync', () => handle.sync())
                },
                close: () => nativeCall('close', () => handle.close()),
              }
            },
          },
        }
      : {}),
  })
  const bridgeCalls: Record<string, number> = {}
  const observed = new Set([
    'stat',
    'exists',
    'mkdir',
    'list',
    'writeBinary',
    'appendBinary',
    'readBinary',
    'rename',
    'remove',
  ])
  const wrappers = new Map<PropertyKey, (...args: unknown[]) => unknown>()
  app.vault.adapter = new Proxy(app.vault.adapter, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== 'function' || !observed.has(String(key))) return value
      let wrapped = wrappers.get(key)
      if (!wrapped) {
        wrapped = (...args: unknown[]) => {
          bridgeCalls[String(key)] = (bridgeCalls[String(key)] ?? 0) + 1
          return value.apply(target, args)
        }
        wrappers.set(key, wrapped)
      }
      return wrapped
    },
  })
  const save = app.saveLocalStorage.bind(app)
  app.saveLocalStorage = (key, value) => {
    if (key === JOURNAL_KEY) counts.journal++
    save(key, value)
  }
  const on = app.vault.on.bind(app.vault)
  vi.spyOn(app.vault, 'on').mockImplementation((...args: Parameters<typeof on>) => {
    counts.indexWaits++
    return on(...args)
  })
  const client = new V2EngineClient(
    encodeAccessToken({
      v: 1,
      address: 'https://sync.example.invalid',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'sample-root', path: '/' },
    }),
    {
      fetch: async (_input, init) => {
        counts.requests++
        trace?.record('GET /v2/files/sample/content', Date.now(), 'complete')
        expect(new Headers(init?.headers).get('range')).toBe(`bytes=0-${bytes.length - 1}`)
        return new Response(bytes.slice(), {
          status: 206,
          headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` },
        })
      },
    }
  )
  const timings: { operation: string; durationMs: number; outcome: string }[] = []
  // Isolate placement work from HTTP source disposal. Both revisions use the same
  // recorded transport with no exposed abort signal; abort-on-close has separate coverage.
  if (isolateTransport) {
    const openVersion = client.openVersion.bind(client)
    client.openVersion = async (...args) => ({ ...(await openVersion(...args)), signal: undefined })
  }
  let firstFileCalls: string[] = []
  let steadyFileCalls: string[] = []
  let steadyNativeCalls: string[] = []
  const perFile: ReturnType<typeof smallPullCounts>[] = []
  const disk = new ObsidianFileSystem(app as never, {
      ...(folder
        ? {
            fileScope: 'Container/Shared',
            connectionId: 'sample',
            adapter: connectionAdapter(
              app.vault.adapter,
              'Container/Shared',
              '.abele-sync/connections/sample'
            ),
          }
        : {}),
      diagnostic: !diagnostics
        ? undefined
        : (operation, startedAt, outcome, paths) => {
            trace?.record(operation, startedAt, outcome, paths)
            timings.push({ operation, durationMs: Date.now() - startedAt, outcome })
            if (operation.startsWith('adapter ')) counts.bridge++
          },
    }),
    locks = new PathCoordinator()
  const beginPull = trace?.beginPull.bind(trace)
  const fs = new Proxy(coordinatedFileSystem(disk, locks), {
      get: (target, key) =>
        key === Symbol.for('abele.sync.trace-pull-v1') && beginPull
          ? beginPull
          : Reflect.get(target, key),
    }),
    state = new MemoryStateStore()
  const placer = new PullPlacer(
    client,
    fs,
    state,
    { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
    sha256
  )
  const started = performance.now()
  try {
    if (folder) {
      await native.mkdir(path('Container/Shared/Notes'), { recursive: true })
      const inventory = Reflect.get(disk, Symbol.for('abele.sync.inventory-pass-v1'))
      return await inventory.call(disk, async () => {
        const directories = await Reflect.get(
          disk,
          Symbol.for('abele.sync.inventory-directories-v1')
        ).call(disk)
        expect(directories.map((one: { path: string }) => one.path)).toContain('Container/Shared')
        return await run()
      })
    }
    return await run()
  } finally {
    quiet?.mockRestore()
    await native.rm(root, { recursive: true, force: true })
  }
  async function run() {
    for (let i = 0; i < count; i++) {
      const eventStart = timings.length
      const requestStart = counts.requests
      const nativeStart = nativeCalls.length
      const change: ChangeItem = {
        seq: i + 1,
        file_id: 'sample-' + i,
        version_id: 'sample-version',
        path: `${folder ? 'Container/Shared/' : ''}Notes/sample-${i}.md`,
        prev_path: null,
        op: 'create',
        kind: 'note',
        sha,
        size: bytes.length,
        mtime: 1000,
        at: '2025-01-01T00:00:00Z',
        actor: { kind: 'system', id: 'sample', name: 'Sample' },
      }
      let result
      if (baseline === true) {
        // The original single-download placement: verified private source stage, then
        // ordinary durable target placement under the lease, and source-stage discard.
        const sourceStage = await fs.beginAtomicWrite('.abele-sync/placement-inbox/' + i, 0, null)
        try {
          await receiveToStage(
            await client.openVersion(change.file_id, change.version_id, {
              sha,
              size: bytes.length,
            }),
            sourceStage,
            { sha, size: bytes.length },
            Reflect.get(placer, 'budget')
          )
          const prepared = Object.create(placer)
          prepared.client = new Proxy(client, {
            get: (target, key) =>
              key === 'openVersion'
                ? () => fs.openRead!(sourceStage.id)
                : typeof Reflect.get(target, key) === 'function'
                  ? Reflect.get(target, key).bind(target)
                  : Reflect.get(target, key),
          })
          result = await locks.run([change.path], () =>
            prepared.placeUnlocked(change, sha, null, new Map(), new Map())
          )
        } finally {
          await sourceStage.discard()
        }
      } else if (baseline === 'chunk-stage') {
        // Previous one-chunk path: memory source, then create/append/seal target stage.
        const source = await client.openVersion(change.file_id, change.version_id, {
          sha,
          size: bytes.length,
        })
        let retained: Uint8Array
        try {
          retained = await source.read(0, bytes.length)
          await source.assertUnchanged()
          expect(await sha256(retained)).toBe(sha)
        } finally {
          await source.close()
        }
        const prepared = Object.create(placer)
        prepared.client = new Proxy(client, {
          get: (target, key) =>
            key === 'openVersion'
              ? async () => ({
                  size: retained.length,
                  read: async (offset: number, length: number) =>
                    retained.slice(offset, offset + length),
                  assertUnchanged: async () => {},
                  close: async () => {},
                })
              : typeof Reflect.get(target, key) === 'function'
                ? Reflect.get(target, key).bind(target)
                : Reflect.get(target, key),
        })
        result = await locks.run([change.path], () =>
          prepared.placeUnlocked(change, sha, null, new Map(), new Map())
        )
      } else result = await placer.place(change, sha, null, new Map(), new Map())
      expect(result).toBe(true)
      expect((await state.get(change.path))?.sha).toBe(sha)
      const operations: Record<string, number> = {}
      for (const event of timings.slice(eventStart))
        operations[event.operation] = (operations[event.operation] ?? 0) + 1
      perFile.push(smallPullCounts(operations, counts.requests - requestStart))
      if (i === 0) firstFileCalls = timings.map((one) => one.operation)
      if (i === 1) steadyFileCalls = timings.slice(eventStart).map((one) => one.operation)
      if (i === 1) steadyNativeCalls = nativeCalls.slice(nativeStart)
    }
    if (diagnostics) expect(timings.some((one) => one.operation === 'journal save')).toBe(true)
    expect(timings.every((one) => one.outcome === 'complete' && one.durationMs >= 0)).toBe(true)
    return {
      counts,
      perFile,
      bridgeCalls,
      consoleCallsDuringPull: quiet?.mock.calls.length ?? 0,
      evidence: trace?.snapshot().firstSync.pulls,
      firstFileCalls,
      steadyFileCalls,
      steadyNativeCalls,
      elapsedMs: performance.now() - started,
    }
  }
}

it('adds no adapter or console bridge calls to 384 iOS-shaped pulls when diagnostics are enabled', async () => {
  const off = await measure(false, false, 384, true, false)
  const on = await measure(false, false, 384, true, true)
  expect(on.bridgeCalls).toEqual(off.bridgeCalls)
  expect(on.consoleCallsDuringPull).toBe(0)
  expect(off.consoleCallsDuringPull).toBe(0)
  for (const key of ['requests', 'writes', 'renames', 'journal', 'flush', 'indexWaits'] as const)
    expect(on.counts[key], key).toBe(off.counts[key])
  expect(on.evidence!.small.count).toBe(384)
  assertPullEvidence(on.evidence!, { small: 384, large: 0, requests: 384 })
  console.log(
    '[iOS diagnostics bridge cost]',
    JSON.stringify({
      files: 384,
      off: off.bridgeCalls,
      on: on.bridgeCalls,
      consoleCalls: on.consoleCallsDuringPull,
    })
  )
}, 60000)

// This comparison runs three implementations, including the old path's native flushes.
// A cold file plus steady-state samples proves per-file overhead without turning disk speed
// under suite load into a correctness requirement. The bounds test below retains 1024/384 files.
it.each([
  { desktop: true, count: 32 },
  { desktop: false, count: 32 },
])(
  'counts every small-file placement operation (desktop=$desktop, files=$count)',
  async ({ desktop, count }) => {
    const before = await measure(desktop, true, count)
    const previous = await measure(desktop, 'chunk-stage', count)
    const after = await measure(desktop, false, count)
    for (const file of after.perFile) assertSmallPullBounds(file)
    console.log('[small pull operations]', {
      desktop,
      count,
      before: { ...before, perFile: undefined },
      previous: { ...previous, perFile: undefined },
      after: { ...after, perFile: undefined },
    })
    // Ordinary atomic writes cross the adapter instead of opening native stage handles.
    // Compare total writes; retain the adapter/native split as diagnostic data.
    for (const key of Object.keys(before.counts) as (keyof typeof before.counts)[])
      if (key !== 'adapterWrites' && key !== 'nativeWrites')
        expect(after.counts[key], key).toBeLessThanOrEqual(before.counts[key])
    for (const key of Object.keys(previous.counts) as (keyof typeof previous.counts)[])
      if (key !== 'adapterWrites' && key !== 'nativeWrites')
        expect(after.counts[key], key).toBeLessThanOrEqual(previous.counts[key])
    expect(after.counts.requests).toBe(count)
    expect(after.counts.renames + after.counts.links).toBe(count)
    expect(after.counts.indexWaits).toBe(0)
    if (!desktop) {
      expect(after.counts.bridge).toBeLessThanOrEqual(count * 12 + 2)
      expect(after.counts.writes).toBe(count) // one bounded crash-safe write
      expect(after.counts.reads).toBe(0)
      expect(after.counts.journal).toBe(count * 2) // create intent, retire
    }
  },
  60000
)

it.each([
  { desktop: true, count: 1024 },
  { desktop: false, count: 384 },
])(
  'enforces the live small-pull bounds on actual transformed code (desktop=$desktop)',
  async ({ desktop, count }) => {
    const result = await measure(desktop, false, count, true)
    const maximum = Object.fromEntries(
      Object.keys(result.perFile[0]).map((key) => [
        key,
        Math.max(...result.perFile.map((file) => file[key as keyof typeof file])),
      ])
    )
    console.log(
      '[live small pull bounds]',
      JSON.stringify({ desktop, count, totals: result.counts, maximum })
    )
    const small = emptyPullSummary()
    for (const file of result.perFile) summarizePull(small, file)
    assertPullEvidence(
      {
        small,
        large: emptyPullSummary(),
        failed: 0,
        overlap: false,
        contentRequests: result.counts.requests,
      },
      { small: count, large: 0, requests: count }
    )
    expect(result.evidence?.small).toEqual(small)
    assertPullEvidence(result.evidence!, { small: count, large: 0, requests: count })
  },
  60000
)

it('keeps native folder connection small pulls within the live bridge bound', async () => {
  const result = await measure(true, false, 3, true, true, true)
  console.log('[folder pull calls]', JSON.stringify(result))
  for (const file of result.perFile) assertSmallPullBounds(file)
})
