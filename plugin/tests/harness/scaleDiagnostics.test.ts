// @vitest-environment node
import { expect, it } from 'vitest'
import diagnostics from '../scale/diagnostics.cjs'
import {
  noticeSummary,
  profileSummary,
  rssSample,
  deadlinePlan,
  tracepointAdjustedTasks,
  symbolizerFromMap,
  allocationAttribution,
} from '../scale/diagnostics.mjs'
import { budgets, longTaskVerdict } from '../scale/oracles.mjs'
import { targetedBudgets } from '../scale/targeted.mjs'

it.each([
  ['ours during sync', 90, 'FAIL'],
  ['plugin load', 799, 'PASS'],
  ['plugin load', 801, 'FAIL'],
  ['host-only', 900, 'PASS'],
  ['harness-triggered', 900, 'PASS'],
  ['unattributed', 90, 'FAIL'],
])('applies the task owner budget to %s at %i ms', (owner, durationMs, status) => {
  const row = { owner, durationMs, profileWindowComplete: owner !== 'unattributed' }
  expect(longTaskVerdict(row).status).toBe(status)
})

it('exports ordinal-bounded heap allocation windows including collected objects', async () => {
  const events: any[] = [], saved: any[] = [], calls: any[] = []
  let ordinal = 1, now = 100
  const profiler = diagnostics.createAllocationProfiler({ now: () => now,
    command: async (name: string, params: any) => {
      calls.push([name, params])
      return { profile: { head: { id: 1, children: [] },
        samples: Array.from({ length: ordinal }, (_, i) => ({ ordinal: i + 1, nodeId: 1, size: 64 })) } }
    }, save: async (p: any) => { saved.push(p); return 'sample.heapprofile' },
    emit: (event: any) => events.push(event) })
  await profiler.start()
  now = 1100
  await profiler.poll(1100)
  ordinal = 2
  now = 2100
  await profiler.poll(2100)
  expect(saved.map(p => p.samples.map(s => s.ordinal))).toEqual([[1], [2]])
  expect(calls).toContainEqual(['HeapProfiler.startSampling', expect.objectContaining({
    samplingInterval: 16384, includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true })])
  expect(events.filter(e => e.event === 'allocation-profile')).toHaveLength(2)
  await profiler.close()
})

it.each(['plugin:abele', 'plugin:scale-observer', 'app://obsidian.md/app.js'])(
  'keeps measured plugin ownership despite preceding allocations from %s', async url => {
  const task = { event: 'long-task', device: '0', startedAt: 1000, durationMs: 100 }
  const captures = [
    { event: 'plugin-entry-ledger-ready', device: '0', generation: 'sample', at: 0,
      coverageStartedAt: 0, complete: true },
    { event: 'plugin-entry-start', device: '0', generation: 'sample', id: 1, at: 1000 },
    { event: 'plugin-entry-end', device: '0', generation: 'sample', id: 1, at: 1100 },
    { event: 'plugin-entry-ledger-checkpoint', device: '0', generation: 'sample', at: 1200,
      complete: true },
    { event: 'cpu-profile', device: '0', startedAt: 0, endedAt: 1200, path: 'cpu',
      clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } },
    { event: 'allocation-profile', device: '0', startedAt: 0, endedAt: 1000,
      complete: true, includeCollected: true, path: 'heap' },
  ]
  const [row] = await profileSummary([task], captures, async path => path === 'cpu' ? {
    startTime: 0, endTime: 1200000, nodes: [
      { id: 1, callFrame: { functionName: '(garbage collector)', url: '' } }],
    samples: [1], timeDeltas: [1050000],
  } : { head: { id: 1, callFrame: { functionName: 'allocate', url }, children: [] },
    samples: [{ ordinal: 1, nodeId: 1, size: 100 }] })
  expect(row.owner).toBe('ours during sync')
  expect(row.allocationAttribution).toMatchObject({ complete: true, totalBytes: 100 })
  expect(longTaskVerdict(row).status).toBe('FAIL')
})

it('rotates heap sampling with an explicit gap before saving the old window', async () => {
  let now = 0
  const calls: string[] = [], events: any[] = []
  const profiler = diagnostics.createAllocationProfiler({ now: () => now, rotationMs: 1000,
    command: async (name: string) => { calls.push(name); return {
      profile: { head: { id: 1 }, samples: [{ ordinal: 1, nodeId: 1, size: 32 }] } } },
    save: async () => { calls.push('save'); return 'sample.heapprofile' },
    emit: (row: any) => events.push(row) })
  await profiler.start()
  now = 1100
  await profiler.poll(now)
  expect(calls.slice(-3)).toEqual(['HeapProfiler.stopSampling', 'HeapProfiler.startSampling', 'save'])
  expect(events).toContainEqual(expect.objectContaining({ event: 'allocation-profile-gap' }))
  await profiler.close()
})
it('keeps the separate load budget when allocation samples explain load-time GC', async () => {
  const [row] = await profileSummary([{ event: 'long-task', device: '0', startedAt: 1000,
    durationMs: 900 }], [
    { event: 'plugin-load-mark', device: '0', name: 'abele:eval-start', at: 1000 },
    { event: 'plugin-load-mark', device: '0', name: 'abele:eval-end', at: 1900 },
    { event: 'cpu-profile', device: '0', startedAt: 0, endedAt: 2000, path: 'cpu',
      clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } },
    { event: 'allocation-profile', device: '0', startedAt: 0, endedAt: 1000,
      complete: true, includeCollected: true, path: 'heap' },
  ], async path => path === 'cpu' ? {
    startTime: 0, endTime: 2000000, nodes: [
      { id: 1, callFrame: { functionName: '(garbage collector)', url: '' } }],
    samples: [1], timeDeltas: [1800000],
  } : { head: { id: 1, callFrame: { functionName: 'allocate', url: 'plugin:scale-observer' } },
    samples: [{ ordinal: 1, nodeId: 1, size: 100 }] })
  expect(row.allocationAttribution.owner).toBe('harness')
  expect(row.owner).toBe('plugin load')
  expect(longTaskVerdict(row).status).toBe('FAIL')
})

it('reports allocation split and refuses missing, tied, stale or interrupted windows', async () => {
  const task = { device: '0', startedAt: 1000 }
  const capture = { event: 'allocation-profile', device: '0', startedAt: 0,
    endedAt: 1000, complete: true, includeCollected: true, path: 'heap' }
  let sizes = [60, 30, 10]
  const load = async () => ({ head: { id: 0, children: [
    { id: 1, callFrame: { url: 'plugin:abele' }, children: [] },
    { id: 2, callFrame: { url: 'plugin:scale-observer' }, children: [] },
    { id: 3, callFrame: { url: 'app://obsidian.md/app.js' }, children: [] },
  ] }, samples: sizes.map((size, i) => ({ ordinal: i + 1, nodeId: i + 1, size })) })
  expect(await allocationAttribution(task, [capture], load)).toMatchObject({ owner: 'plugin',
    splitBytes: { plugin: 60, harness: 30, host: 10, unknown: 0 }, totalBytes: 100 })
  sizes = [50, 50, 0]
  expect((await allocationAttribution(task, [capture], load)).owner).toBeNull()
  expect((await allocationAttribution(task, [], load)).complete).toBe(false)
  expect((await allocationAttribution({ ...task, startedAt: 5000 }, [capture], load)).complete).toBe(false)
  expect((await allocationAttribution(task, [capture, { event: 'allocation-profile-gap',
    device: '0', startedAt: 900, endedAt: 950 }], load)).complete).toBe(false)
})

it.each(['plugin:abele', ''])('does not excuse a separate long non-GC span from %s', async url => {
  const task = { event: 'long-task', device: '0', startedAt: 1000, durationMs: 200 }
  const captures = [
    { event: 'cpu-profile', device: '0', startedAt: 0, endedAt: 1300, path: 'cpu',
      clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } },
    { event: 'allocation-profile', device: '0', startedAt: 0, endedAt: 1000,
      complete: true, includeCollected: true, path: 'heap' },
  ]
  const [row] = await profileSummary([task], captures, async path => path === 'cpu' ? {
    startTime: 0, endTime: 1300000, nodes: [
      { id: 1, callFrame: { functionName: '(garbage collector)', url: '' } },
      { id: 2, callFrame: { functionName: 'work', url } }],
    samples: [1, 2], timeDeltas: [1120000, 80000],
  } : { head: { id: 1, callFrame: { functionName: 'allocate', url: 'plugin:scale-observer' } },
    samples: [{ ordinal: 1, nodeId: 1, size: 100 }] })
  expect(row.owner).toBe(url ? 'ours during sync' : 'unattributed')
  expect(longTaskVerdict(row).status).toBe('FAIL')
})

it('fails a claimed host task when its profile window is incomplete', () => {
  expect(longTaskVerdict({ owner: 'host-only', durationMs: 100,
    profileWindowComplete: false }).status).toBe('FAIL')
})

it('enforces the same owner verdict in full and targeted runs', () => {
  const longTaskAttribution = [{ owner: 'ours during sync', durationMs: 80,
    profileWindowComplete: true }]
  expect(budgets({ profileCoverageRequired: true, longTaskAttribution })
    .find(row => row.name === 'long task ownership and budgets')?.status).toBe('FAIL')
  expect(targetedBudgets({ profileCoverageRequired: true, longTaskAttribution,
    targeted: { E: { complete: true } }, installedFileReadbackBytes: 0,
    unknownInstalledReadbackCount: 0, mismatches: [] })
    .find(row => row.name === 'long task ownership and budgets')?.status).toBe('FAIL')
})

it('charges evaluation to plugin load and later startup sync work to the sync budget', async () => {
  const tasks = [
    { event: 'long-task', device: '0', startedAt: 100, durationMs: 100 },
    { event: 'long-task', device: '0', startedAt: 300, durationMs: 100 },
  ]
  const captures = [
    { event: 'cpu-profile-ready', device: '0', at: 90 },
    { event: 'plugin-load-mark', name: 'abele:eval-start', device: '0', at: 120 },
    { event: 'plugin-load-mark', name: 'abele:eval-end', device: '0', at: 190 },
    { event: 'plugin-load-mark', name: 'abele:onload-end', device: '0', at: 250 },
    ...tasks.map((task, index) => ({ event: 'cpu-profile', device: '0',
      startedAt: task.startedAt, endedAt: task.startedAt + task.durationMs,
      path: String(index), clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } })),
  ]
  const rows = await profileSummary(tasks, captures, async path => ({
    startTime: tasks[Number(path)].startedAt * 1000,
    endTime: (tasks[Number(path)].startedAt + 100) * 1000,
    nodes: [{ id: 1, callFrame: { functionName: 'sync', url: 'plugin:abele' } }],
    samples: [1], timeDeltas: [50000] }))
  expect(rows.map(row => row.owner)).toEqual(['plugin load', 'ours during sync'])
})

it('classifies GC through its parent and leaves a parentless native sample unknown', async () => {
  const tasks = [
    { event: 'long-task', device: '0', startedAt: 0, durationMs: 100 },
    { event: 'long-task', device: '1', startedAt: 0, durationMs: 100 },
  ]
  const captures = tasks.map((task) => ({ event: 'cpu-profile', device: task.device,
    startedAt: 0, endedAt: 100, path: task.device, continuous: true }))
  const rows = await profileSummary(tasks, captures, async (path) => path === '0' ? ({
    nodes: [
      { id: 1, children: [2], callFrame: { functionName: 'allocate', url: 'plugin:abele' } },
      { id: 2, callFrame: { functionName: '(garbage collector)', url: '' } },
    ], samples: [2], timeDeltas: [50000],
  }) : ({ nodes: [{ id: 1, callFrame: { functionName: 'native', url: '' } }],
    samples: [1], timeDeltas: [50000] }))
  expect(rows[0].samplesBySource.abele).toBe(1)
  expect(rows[1].owner).toBe('unattributed')
})

it('retains unresolved samples while definite plugin frames establish plugin ownership', async () => {
  const tasks = [{ event: 'long-task', device: '0', startedAt: 0, durationMs: 100 }]
  const captures = [{ event: 'cpu-profile', device: '0', startedAt: 0, endedAt: 100,
    path: 'sample', continuous: true,
    clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } }]
  const rows = await profileSummary(tasks, captures, async () => ({
    startTime: 0, endTime: 100000,
    nodes: [
      { id: 1, callFrame: { functionName: 'sync', url: 'plugin:abele' } },
      { id: 2, callFrame: { functionName: '(program)', url: '' } },
    ], samples: [1, 2], timeDeltas: [50000, 50000],
  }))
  expect(rows[0].samplesBySource).toEqual({ abele: 1, unknown: 1 })
  expect(rows[0].owner).toBe('ours during sync')
  expect(longTaskVerdict(rows[0]).status).toBe('FAIL')
})

it('resolves a generated plugin frame through the exact external map', () => {
  const symbolize = symbolizerFromMap({ version: 3, file: 'main.js', sources: ['src/sync/example.ts'],
    names: ['prepareInventory'], mappings: 'AAAAA' })
  expect(symbolize({ url: 'plugin:abele', lineNumber: 0, columnNumber: 0,
    functionName: 'a' })).toMatchObject({ originalSource: 'src/sync/example.ts',
    originalName: 'prepareInventory' })
})

it('records rotation gaps and starts the next capture before saving the previous one', async () => {
  const calls: string[] = [], events = []
  const profiler = diagnostics.createStallProfiler({ continuous: true, maxCaptureMs: 100,
    command: async (name: string) => { calls.push(name); return { profile: { nodes: [] } } },
    save: async () => { calls.push('save'); return 'sample' },
    emit: (row) => events.push(row) })
  profiler.heartbeat(0)
  await profiler.poll(0)
  await profiler.poll(101)
  expect(calls).toEqual(['Profiler.start', 'Profiler.stop', 'Profiler.start', 'save'])
  expect(events).toContainEqual(expect.objectContaining({ event: 'cpu-profile-gap',
    reason: 'rotation' }))
  await profiler.close(102)
})

it('keeps a running profiler across a reload in the same renderer', async () => {
  const { readFile } = await import('node:fs/promises')
  const { runInNewContext } = await import('node:vm')
  const { EventEmitter } = await import('node:events')
  const source = await readFile(new URL('../scale/diagnostics.cjs', import.meta.url), 'utf8')
  const wc = new EventEmitter() as any
  let attached = false
  const calls: string[] = []
  wc.debugger = { isAttached: () => attached, attach: () => { attached = true },
    detach: () => { attached = false }, sendCommand: async (name: string) => {
      calls.push(name)
      return name === 'Performance.getMetrics' ?
        { metrics: [{ name: 'Timestamp', value: 1 }] } : { profile: { nodes: [] } }
    } }
  const module = { exports: {} }
  runInNewContext(source, { module, exports: module.exports, Date, setInterval: () => 1,
    clearInterval() {}, require: (name: string) => {
      if (name === 'electron') return { webContents: { fromId: () => wc }, ipcMain: new EventEmitter() }
      if (name === 'node:crypto') return { randomUUID: () => 'sample' }
      if (name === '/sample/evidence-writer.cjs') return { writerFor: () => ({ enqueue() {}, async flush() {} }) }
      if (name === 'node:fs') return { mkdirSync() {}, writeFileSync() {} }
      throw Error(name)
    } })
  const api = module.exports as any
  const config = JSON.stringify({ evidence: 'sample', evidenceWriter: '/sample/evidence-writer.cjs', device: '0', continuousCpu: true,
    javascriptHashTracepoints: [], profileDirectory: '/sample' })
  const first = await api.watch(7, config)
  const second = await api.watch(7, config)
  expect(second).toBe(first)
  expect(calls.filter(name => name === 'Profiler.start')).toHaveLength(1)
  expect(calls.filter(name => name === 'Profiler.stop')).toHaveLength(0)
  await api.unwatch(first)
})

it('keeps a large activity snapshot in bounded receipts without dropping refusals or events', () => {
  const refused = Array.from({ length: 33000 }, (_, i) => ({
    path: `Notes/Sample ${i}.md`,
    reason: 'sample reason '.repeat(12),
  }))
  const events = [{ at: 100, text: 'sample failure' }]
  const state = {
    event: 'primary-state',
    snapshot: { rows: [{ status: 'error' }] },
    activity: [
      {
        refused,
        events,
        id: 'sample',
        classification: { hits: { prepare: 3 }, bytes: 7, firstReads: [{ stack: 'at sample' }] },
      },
    ],
  }
  expect(Buffer.byteLength(JSON.stringify(state))).toBeGreaterThan(4 * 1024 ** 2)
  const chunks = diagnostics.stateChunks(state)
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks.every((chunk) => Buffer.byteLength(JSON.stringify(chunk)) <= 1024 ** 2)).toBe(true)
  expect(chunks.flatMap((chunk) => chunk.activity.flatMap((a) => a.refused))).toEqual(refused)
  expect(chunks.flatMap((chunk) => chunk.activity.flatMap((a) => a.events))).toEqual(events)
  expect(chunks.every((chunk) => chunk.snapshot === state.snapshot)).toBe(true)
  expect(chunks.map((chunk) => chunk.activityChunk)).toEqual(
    chunks.map((_, index) => ({ index, total: chunks.length }))
  )
  expect(
    chunks.every((chunk) => chunk.activity[0].classification === state.activity[0].classification)
  ).toBe(true)
  expect(state.activity[0].refused).toHaveLength(33000)
})

it('fails explicitly if one activity value alone exceeds the receipt budget', () => {
  expect(() =>
    diagnostics.stateChunks({ activity: [{ refused: [{ reason: 'x'.repeat(2 ** 21) }] }] })
  ).toThrow('Activity value exceeds receipt budget')
})

it('attributes identical notice text to its creation stack, never its wording', () => {
  let stack = 'Error\n at host (app://obsidian.md/app.js:4:2)'
  class Notice {
    noticeEl = { textContent: '' }
    setMessage(text) {
      this.noticeEl.textContent = text
    }
  }
  const observer = diagnostics.observeNotices({ Notice }, () => stack)
  const host = new Notice()
  host.setMessage('Indexing vault...')
  stack = 'Error\n at feature (plugin:abele:40:2)\n at host (app://obsidian.md/app.js:4:2)'
  const plugin = new Notice()
  plugin.setMessage('Indexing vault...')
  expect(observer.origin(host.noticeEl).source).toBe('host')
  expect(observer.origin(plugin.noticeEl).source).toBe('abele')
  expect(observer.origin({}).source).toBe('unknown')
  observer.close()
})

it('separates host notices while unknown origin fails attribution and plugin notices fail their gate', () => {
  const counts = noticeSummary([
    { event: 'notice', source: 'host' },
    { event: 'notice', source: 'abele' },
    { event: 'notice' },
  ])
  expect(counts).toEqual({ host: 1, abele: 1, otherPlugin: 0, unknown: 1, total: 3 })
  expect(
    budgets({ notices: 0, noticeCounts: counts }).find((r) => r.name === 'notice attribution')
      ?.status
  ).toBe('FAIL')
  expect(
    budgets({ notices: counts.abele, noticeCounts: counts })
      .filter((r) => r.name.startsWith('notice'))
      .every((r) => r.status === 'FAIL')
  ).toBe(true)
  expect(
    budgets({ notices: 0, noticeCounts: { ...counts, abele: 0, unknown: 0 } })
      .filter((r) => r.name.startsWith('notice'))
      .every((r) => r.status === 'PASS')
  ).toBe(true)
})

it('profiles only stalled heartbeat windows and saves the debugger CPU evidence', async () => {
  const calls = [],
    saved = [],
    events = []
  const profiler = diagnostics.createStallProfiler({
    command: async (name) => {
      calls.push(name)
      return name === 'Profiler.stop' ? { profile: { samples: [1], nodes: [] } } : {}
    },
    save: async (profile) => {
      saved.push(profile)
      return 'sample.cpuprofile'
    },
    emit: (e) => events.push(e),
    stallMs: 75,
    maxCaptureMs: 10000,
  })
  profiler.heartbeat(100)
  await profiler.poll(150)
  expect(calls).toEqual([])
  await profiler.poll(180)
  expect(calls).toEqual(['Profiler.start'])
  profiler.heartbeat(300)
  await profiler.poll(310)
  expect(calls).toEqual(['Profiler.start', 'Profiler.stop'])
  expect(saved).toHaveLength(1)
  expect(events).toContainEqual(
    expect.objectContaining({
      event: 'cpu-profile',
      startedAt: 180,
      endedAt: 310,
      path: 'sample.cpuprofile',
    })
  )
  await profiler.close(320)
})

it('keeps unprofiled long tasks unknown and retains mixed host/plugin sample attribution', async () => {
  const profile = {
    nodes: [
      { id: 1, callFrame: { functionName: 'index', url: 'app://obsidian.md/app.js' } },
      { id: 2, callFrame: { functionName: 'sync', url: 'plugin:abele' } },
    ],
    samples: [1, 2],
    timeDeltas: [1000, 1000],
  }
  const result = await profileSummary(
    [
      { event: 'long-task', device: '0', startedAt: 100, durationMs: 300 },
      { event: 'long-task', device: '1', startedAt: 100, durationMs: 300 },
    ],
    [{ event: 'cpu-profile', device: '0', startedAt: 200, endedAt: 350, path: 'sample' }],
    async () => profile
  )
  expect(result[0].samplesBySource).toEqual({ host: 1, abele: 1 })
  expect(result[0].profiles).toEqual(['sample'])
  expect(result[1].source).toBe('unknown')
})

it('aggregates only the owned app process tree and plans five hours with cleanup reserve', () => {
  expect(rssSample('1 0 100\n2 1 200\n3 2 300\n4 0 900', 1)).toEqual({
    rssBytes: 600 * 1024,
    pids: [1, 2, 3],
    processes: [
      { pid: 1, rssBytes: 100 * 1024 },
      { pid: 2, rssBytes: 200 * 1024 },
      { pid: 3, rssBytes: 300 * 1024 },
    ],
  })
  expect(rssSample('4 0 900', 1)).toBeNull()
  expect(deadlinePlan(1000)).toEqual({
    workerStartedAt: 1000,
    workerDeadlineAt: 18001000,
    scenarioDeadlineAt: 17101000,
    cleanupReserveMs: 900000,
  })
})

it('disables backend CPU sampling after a failed capture instead of leaving a profiler running', async () => {
  const calls = []
  const profiler = diagnostics.createStallProfiler({
    command: async (name) => {
      calls.push(name)
      if (name === 'Profiler.stop') throw new Error('sample failure')
    },
    save: async () => '',
    emit: () => {},
  })
  profiler.heartbeat(0)
  await profiler.poll(100)
  profiler.heartbeat(200)
  await profiler.poll(210)
  expect(calls).toContain('Profiler.disable')
  await profiler.close(220)
})

it.each([true, false])(
  'waits for main-process profiling setup and scopes read observation: %s',
  async (observeContentReads) => {
    const { readFile } = await import('node:fs/promises')
    const { runInNewContext } = await import('node:vm')
    const source = await readFile(new URL('../scale/observer.cjs', import.meta.url), 'utf8')
    const events = [],
      observers = [],
      cleanup = [],
      sent = []
    let release,
      closed = false
    const ready = new Promise((resolve) => {
      release = resolve
    })
    const config = {
      device: '0',
      evidence: 'sample', evidenceWriter: '/sample/evidence-writer.cjs',
      observeContentReads,
      writeObserver: '/sample/writes.cjs',
      reindexObserver: '/sample/reindex.cjs',
      diagnostics: '/sample/diagnostics.cjs',
    }
    const module = { exports: null }
    runInNewContext(source, {
      module,
      process: { pid: 42 },
      console: { debug() {} },
      performance: { timeOrigin: 1000 },
      setInterval: () => 1,
      clearInterval() {},
      document: { body: {}, querySelectorAll: () => [] },
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      PerformanceObserver: class {
        constructor(callback) {
          observers.push(callback)
        }
        observe() {}
        disconnect() {}
      },
      require: (name) => {
        if (name === 'obsidian')
          return {
            Plugin: class {
              app = { vault: { adapter: { getBasePath: () => '/sample' } } }
              register(fn) {
                cleanup.push(fn)
              }
            },
          }
        if (name === 'fs')
          return {
            existsSync: () => false,
            readFileSync: () => JSON.stringify(config),
            appendFileSync: (_p, line) => events.push(JSON.parse(line)),
          }
        if (name === 'node:crypto') return {}
        if (name === 'path') return { join: (...p) => p.join('/') }
        if (name === config.reindexObserver)
          return { observeRebuild: () => {}, observeHashes: () => () => {} }
        if (name === config.writeObserver)
          return {
            configureModules() {}, observeWrites: () => () => events.push({ event: 'cleanup-write' }),
            observeReads: () => () => events.push({ event: 'cleanup-read' }),
          }
        if (name === config.diagnostics) return diagnostics
        if (name === 'electron')
          return {
            ipcRenderer: {
              send: (channel, text) =>
                channel === 'sample-evidence' ? events.push(JSON.parse(text)) : sent.push(channel),
              invoke: async () => true,
            },
          }
        if (name === '@electron/remote')
          return {
            getCurrentWebContents: () => ({ id: 7 }),
            require: () => ({
              openEvidencePort: () => 'sample-evidence',
              watch: async (id, serialized) => {
                expect(JSON.parse(serialized).device).toBe('0')
                expect(id).toBe(7)
                await ready
                return 'sample-heartbeat'
              },
              unwatch: () => {
                closed = true
              },
            }),
          }
        throw new Error('Unexpected fixture module')
      },
    })
    let finished = false
    const pending = new module.exports().onload().then(() => {
      finished = true
    })
    expect(finished).toBe(false)
    release()
    await pending
    expect(events).toContainEqual(expect.objectContaining({ event: 'renderer-start', pid: 42 }))
    expect(sent).toEqual(['sample-heartbeat'])
    observers.at(-1)({ getEntries: () => [{ startTime: 50, duration: 7061, attribution: [] }] })
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'long-task', startedAt: 1050, durationMs: 7061 })
    )
    cleanup.forEach((fn) => fn())
    expect(events.filter((e) => e.event.startsWith('cleanup-')).map((e) => e.event)).toEqual(
      observeContentReads ? ['cleanup-read', 'cleanup-write'] : ['cleanup-write']
    )
    expect(closed).toBe(true)
  }
)

it('does not pass a run whose phase checkpoint failed', () => {
  expect(
    budgets({ checkpointFailure: true }).find((row) => row.name === 'phase evidence')?.status
  ).toBe('FAIL')
})

it('does not mistake an unrelated app.js URL or another plugin for the host or Abele', () => {
  expect(diagnostics.classifyOrigin('Error\n    at run (https://example.test/app.js:1:1)')).toBe(
    'unknown'
  )
  expect(diagnostics.classifyOrigin('Error\n    at run (plugin:abele-extra:1:1)')).toBe(
    'other-plugin'
  )
})

it('aligns CPU samples with the calibrated debugger clock even when start acknowledgement follows the task', async () => {
  const [task] = await profileSummary(
    [{ event: 'long-task', device: '0', startedAt: 1000, durationMs: 500 }],
    [
      {
        event: 'cpu-profile',
        device: '0',
        startedAt: 1100,
        startAcknowledgedAt: 1600,
        endedAt: 1700,
        path: 'sample',
        clock: { timestampMs: 9000, beforeAt: 1000, afterAt: 1002 },
      },
    ],
    async () => ({
      startTime: 9100000,
      nodes: [{ id: 1, callFrame: { functionName: 'sync', url: 'plugin:abele' } }],
      samples: [1],
      timeDeltas: [100000],
    })
  )
  expect(task.samplesBySource).toEqual({ abele: 1 })
})

it('recognizes host-bundled indexing libraries only at the host application origin', () => {
  expect(
    diagnostics.classifyOrigin(
      'Error\n at tokenize (app://obsidian.md/lib/prism.min.js:1:2)\n at index (app://obsidian.md/app.js:2:3)'
    )
  ).toBe('host')
  expect(
    diagnostics.classifyOrigin('Error\n at tokenize (https://example.test/lib/prism.min.js:1:2)')
  ).toBe('unknown')
})

it('recognizes the host DOM helper in a captured notice creation stack', () => {
  expect(
    diagnostics.classifyOrigin(
      'Error\n at capture (/sample/diagnostics.cjs:1:1)\n at window.createEl (app://obsidian.md/enhance.js:1:9548)\n at new Notice (app://obsidian.md/app.js:1:1302954)\n at app://obsidian.md/app.js:1:1758476'
    )
  ).toBe('host')
})

it('replaces only its own debugger watch across a renderer reload', async () => {
  const { readFile } = await import('node:fs/promises')
  const { runInNewContext } = await import('node:vm')
  const { EventEmitter } = await import('node:events')
  const source = await readFile(new URL('../scale/diagnostics.cjs', import.meta.url), 'utf8')
  const wc = new EventEmitter() as any
  let attached = false,
    detached = 0
  wc.debugger = {
    isAttached: () => attached,
    attach: () => {
      attached = true
    },
    detach: () => {
      attached = false
      detached++
    },
    sendCommand: async (name) =>
      name === 'Performance.getMetrics' ? { metrics: [{ name: 'Timestamp', value: 1 }] } : {},
  }
  const ipcMain = new EventEmitter(),
    rows = []
  let sequence = 0
  const module = { exports: {} }
  runInNewContext(source, {
    exports: module.exports,
    module,
    Date,
    setInterval: () => 1,
    clearInterval() {},
    require: (name) => {
      if (name === 'electron') return { webContents: { fromId: () => wc }, ipcMain }
      if (name === 'node:crypto') return { randomUUID: () => String(++sequence) }
      if (name === '/sample/evidence-writer.cjs')
        return { writerFor: () => ({ enqueue: (line) => rows.push(JSON.parse(line)), async flush() {} }) }
      if (name === 'node:fs')
        return {
          appendFileSync: (_p, line) => rows.push(JSON.parse(line)),
          mkdirSync() {},
          writeFileSync() {},
        }
      throw Error(name)
    },
  })
  const api = module.exports as any,
    config = JSON.stringify({ evidence: 'sample', evidenceWriter: '/sample/evidence-writer.cjs', device: '0' })
  const first = await api.watch(7, config)
  expect(await api.beginReindexCoverage(first, 'sample')).toBe(true)
  const second = await api.watch(7, config)
  expect(first).not.toBe(second)
  expect(rows.filter((row) => row.event === 'cpu-profile-ready')).toHaveLength(2)
  expect(detached).toBe(1)
  expect(rows.filter((row) => row.event === 'reindex-js-coverage')).toHaveLength(1)
  wc.emit('did-start-navigation', {}, 'app://obsidian.md', false, true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(wc.listenerCount('did-start-navigation')).toBe(0)
  expect(attached).toBe(false)
  expect(ipcMain.eventNames()).toHaveLength(0)
  attached = true // A debugger owned by somebody else must stay attached.
  await api.watch(7, config)
  expect(detached).toBe(2)
  expect(rows.at(-1).event).toBe('cpu-profile-unavailable')
})

it('arms continuous sampling before renderer work and rotates without waiting for a stall', async () => {
  const calls = []
  const profiler = diagnostics.createStallProfiler({
    command: async (name) => {
      calls.push(name)
      return { profile: { samples: [], nodes: [] } }
    },
    save: async () => 'sample.cpuprofile',
    emit() {},
    continuous: true,
    maxCaptureMs: 60000,
  })
  profiler.heartbeat(100)
  await profiler.poll(100)
  expect(calls).toEqual(['Profiler.start'])
  profiler.heartbeat(200)
  await profiler.poll(201)
  expect(calls).toEqual(['Profiler.start'])
  await profiler.poll(60100)
  expect(calls).toEqual(['Profiler.start', 'Profiler.stop', 'Profiler.start'])
  await profiler.close(60200)
  expect(calls.at(-1)).toBe('Profiler.stop')
})

it('retains plugin ownership when a harness leaf is called by plugin code', async () => {
  const tasks = [{ event: 'long-task', device: '0', startedAt: 0, durationMs: 100 }]
  const captures = [
    {
      event: 'cpu-profile',
      device: '0',
      startedAt: 0,
      endedAt: 100,
      path: 'sample',
      continuous: true,
    },
  ]
  const [result] = await profileSummary(tasks, captures, async () => ({
    nodes: [
      { id: 1, callFrame: { url: '/fixture/scale-observer/reindex.cjs', functionName: 'emit' } },
      { id: 2, children: [1], callFrame: { url: 'plugin:abele', functionName: 'digest' } },
    ],
    samples: [1],
    timeDeltas: [50000],
  }))
  expect(result.samplesBySource).toEqual({ abele: 1 })
  expect(longTaskVerdict(result).status).toBe('FAIL')
  expect(result.coverage).toContain('Continuous')
})

it('records only visible status words and retains refusal counts in chunked activity', () => {
  const nodes = [
    {
      textContent: '1 file not synced',
      className: 'abele-sync-status',
      getClientRects: () => [1],
      getAttribute: () => 'Sync',
    },
    {
      textContent: 'Synced',
      className: 'abele-sync-window__line',
      getClientRects: () => [],
      getAttribute: () => null,
    },
  ]
  expect(diagnostics.visibleStatus({ querySelectorAll: () => nodes })).toEqual([
    { text: '1 file not synced', label: 'Sync', selector: 'abele-sync-status' },
  ])
  const state = {
    snapshot: { visibleStatus: [{ text: '1 file not synced' }] },
    activity: [
      {
        notSynced: [{ path: 'sample.md' }],
        refused: Array.from({ length: 20 }, () => ({ reason: 'x'.repeat(100) })),
        events: [],
      },
    ],
  }
  const chunks = diagnostics.stateChunks(state, 1024)
  expect(chunks.length).toBeGreaterThan(1)
  for (const chunk of chunks)
    expect(chunk.activity[0].notSynced).toEqual(state.activity[0].notSynced)
})

it('arms constructor tracepoints only at the synchronous post-evaluation boundary', async () => {
  const calls = []
  let listener
  const transport = {
    on: (_name, fn) => {
      listener = fn
    },
    removeListener: () => {},
    sendCommand: async (name, params) => {
      calls.push({ name, params })
      if (name === 'Debugger.getScriptSource')
        return { scriptSource: 'class SHA256 extends HashMD {}' }
      return { breakpointId: params?.lineNumber === 20 ? 'gate' : 'hash', locations: [] }
    },
  }
  const events = []
  await diagnostics.armHashTracepoints(transport, [4, 5], 20, (e) => events.push(e))
  expect(
    calls.filter((c) => c.name === 'Debugger.setBreakpointByUrl').map((c) => c.params.lineNumber)
  ).toEqual([20])
  await listener(null, 'Debugger.paused', {
    hitBreakpoints: ['gate'],
    callFrames: [{ callFrameId: 'frame-first', location: { scriptId: 'first' } }],
  })
  expect(
    calls.filter((c) => c.name === 'Debugger.setBreakpoint').map((c) => c.params.location)
  ).toEqual([
    { scriptId: 'first', lineNumber: 4 },
    { scriptId: 'first', lineNumber: 5 },
  ])
  await listener(null, 'Debugger.paused', {
    hitBreakpoints: ['gate'],
    callFrames: [{ callFrameId: 'frame-reload', location: { scriptId: 'reload' } }],
  })
  expect(
    calls
      .filter((c) => c.name === 'Debugger.setBreakpoint')
      .slice(-2)
      .map((c) => c.params.location.scriptId)
  ).toEqual(['reload', 'reload'])
  expect(calls.filter((c) => c.name === "Debugger.evaluateOnCallFrame")).toEqual([])
  const { runInNewContext } = await import("node:vm")
  const { default: capture } = await import("../scale/receipt-capture.cjs")
  const deferred = []
  let constructed = 0
  const source = capture.instrumentReceiptAccess(`
    function durableHostOf() {} function storageOf() {} class BoundedVaultIo {}
    class SHA256 extends HashMD { constructor() { super(); constructed() } }
  `)
  runInNewContext(source, {
    HashMD: class {}, constructed: () => { constructed++ },
    __scaleWarmHashConstructors: work => capture.scheduleHashWarmup(work,
      event => events.push(event), callback => deferred.push(callback)),
  })
  expect(constructed).toBe(0)
  expect(deferred).toHaveLength(1)
  deferred[0]()
  expect(constructed).toBe(1)
  expect(
    events.some((e) => e.event === 'javascript-hash-tracepoint-setup' && e.phase === 'warm-up')
  ).toBe(true)
  expect(calls.at(-1).name).toBe('Debugger.resume')
  expect(events.some((e) => e.event === 'javascript-hash-tracepoint-setup')).toBe(true)
})

it('retains connection classification counters and read stacks in restart summaries', () => {
  const classification = {
    storage: 'indexeddb',
    rowsLoaded: 7,
    hits: { prepare: 9 },
    misses: { prepare: { identity: 2 } },
    reads: 2,
    bytes: 80,
    firstReads: [{ stack: 'at sample', bytes: 40 }],
  }
  expect(diagnostics.classificationSnapshot({ sample: { classification }, other: {} })).toEqual([
    { id: 'sample', classification },
    { id: 'other', classification: null },
  ])
})

it('retains classification in controller status and settled activity snapshots', async () => {
  const { RealVault } = await import('../scale/run.mjs')
  const { runInNewContext } = await import('node:vm')
  const classification = {
    hits: { prepare: 4 },
    misses: { prepare: { absent: 1 } },
    bytes: 12,
    firstReads: [{ stack: 'at sample' }],
  }
  const context = {
    window: {},
    app: {
      plugins: {
        plugins: {
          abele: {
            tokenEngines: {
              live: new Map(),
              ui: {
                rows: { value: [] },
                activity: {
                  value: {
                    sample: {
                      classification,
                      waiting: 2,
                      waitingFiles: [{ path: 'sample.md', code: 'quota_waiting' }],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
  const vault = new RealVault({}, '/sample-vault')
  vault.evaluate = (body) => runInNewContext(`(()=>{${body}})()`, context)
  expect((await vault.snapshot()).activity).toMatchObject([
    {
      id: 'sample',
      classification,
      waiting: 2,
      waitingFiles: [{ path: 'sample.md', code: 'quota_waiting' }],
    },
  ])
  expect(await vault.activityEvidence()).toMatchObject([{ id: 'sample', classification }])
})

it('resumes the renderer and reports missing hash coverage if setup fails', async () => {
  let listener
  const calls = []
  const events = []
  const transport = {
    on: (_name, fn) => {
      listener = fn
    },
    removeListener() {},
    sendCommand: async (name) => {
      calls.push(name)
      if (name === 'Debugger.setBreakpoint') throw new Error('sample failure')
      return { breakpointId: 'gate' }
    },
  }
  await diagnostics.armHashTracepoints(transport, [1], 20, (e) => events.push(e))
  await listener(null, 'Debugger.paused', {
    hitBreakpoints: ['gate'],
    callFrames: [{ location: { scriptId: 'sample' } }],
  })
  expect(calls.at(-1)).toBe('Debugger.resume')
  expect(events.map((e) => e.event)).toEqual([
    'javascript-hash-observer-unavailable',
    'javascript-hash-tracepoint-setup',
  ])
})

it('reports task durations with setup interval unions removed without changing raw evidence', () => {
  const tasks = [
    { device: '0', startedAt: 100, durationMs: 200 },
    { device: '1', startedAt: 100, durationMs: 200 },
  ]
  const setups = [
    { device: '0', startedAt: 90, endedAt: 120 },
    { device: '0', startedAt: 110, endedAt: 140 },
    { device: '0', startedAt: 280, endedAt: 350 },
  ]
  expect(
    tracepointAdjustedTasks(tasks, setups).map((t) => [
      t.durationMs,
      t.tracepointSetupMs,
      t.withoutTracepointSetupMs,
    ])
  ).toEqual([
    [200, 60, 140],
    [200, 0, 200],
  ])
  expect(tasks[0].durationMs).toBe(200)
})

it('retains seeded and live sync request/cycle reasons, callers and queued evidence', () => {
  const received = [],
    originalLines = []
  const original = function (line) {
    originalLines.push([this, line])
    return 'logged'
  }
  const trace = {
    lines: [
      'sync: cycle direct caller: sample-start',
      '',
      'sync: request start caller: sample-start (queued)',
    ],
    lineCount: 2,
    lineNext: 1,
    log: original,
  }
  const close = diagnostics.observeSyncTrace(trace, (event) => received.push(event))
  expect(received.map((e) => [e.line, e.seeded])).toEqual([
    ['sync: request start caller: sample-start (queued)', true],
    ['sync: cycle direct caller: sample-start', true],
  ])
  expect(trace.log('sync: cycle start, direct caller: sample-a | sample-b')).toBe('logged')
  expect(received.at(-1)).toEqual({
    event: 'engine-sync-diagnostic',
    line: 'sync: cycle start, direct caller: sample-a | sample-b',
    seeded: false,
  })
  trace.log('ordinary file activity')
  expect(received).toHaveLength(3)
  expect(originalLines[0][0]).toBe(trace)
  close()
  expect(trace.log).toBe(original)
})
