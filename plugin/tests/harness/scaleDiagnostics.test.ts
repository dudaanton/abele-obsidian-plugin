// @vitest-environment node
import { expect, it } from 'vitest'
import diagnostics from '../scale/diagnostics.cjs'
import { noticeSummary, profileSummary, rssSample, deadlinePlan } from '../scale/diagnostics.mjs'
import { budgets } from '../scale/oracles.mjs'

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

it('waits for main-process profiling setup before finishing observer load and keeps long-task start times', async () => {
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
    evidence: 'sample',
    writeObserver: '/sample/writes.cjs',
    diagnostics: '/sample/diagnostics.cjs',
  }
  const module = { exports: null }
  runInNewContext(source, {
    module,
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
          readFileSync: () => JSON.stringify(config),
          appendFileSync: (_p, line) => events.push(JSON.parse(line)),
        }
      if (name === 'path') return { join: (...p) => p.join('/') }
      if (name === config.writeObserver) return { observeWrites: () => () => {} }
      if (name === config.diagnostics) return diagnostics
      if (name === 'electron') return { ipcRenderer: { send: (channel) => sent.push(channel) } }
      if (name === '@electron/remote')
        return {
          getCurrentWebContents: () => ({ id: 7 }),
          require: () => ({
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
  expect(sent).toEqual(['sample-heartbeat'])
  observers.at(-1)({ getEntries: () => [{ startTime: 50, duration: 7061, attribution: [] }] })
  expect(events).toContainEqual(
    expect.objectContaining({ event: 'long-task', startedAt: 1050, durationMs: 7061 })
  )
  cleanup.forEach((fn) => fn())
  expect(closed).toBe(true)
})

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
