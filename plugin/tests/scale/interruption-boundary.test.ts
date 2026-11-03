// @vitest-environment node
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import diagnostics from './diagnostics.cjs'
import { flushExitEvidence } from './exit-evidence.mjs'
import { longTaskScope, profileSummary } from './diagnostics.mjs'
import { longTaskVerdict } from './oracles.mjs'
import boundary from './interruption-boundary.cjs'

it.each(['reindex-primary-upload', 'reindex-peer-download', 'reindex-restart-comparison'])(
  'saves the live %s segment after the receipt and before navigation replaces it',
  async (id) => {
    const source = await readFile(new URL('./reindex.cjs', import.meta.url), 'utf8')
    const order: string[] = ['restart acknowledged']
    let navigated = false,
      scheduled: () => Promise<void> = async () => {}
    const saved: any[] = []
    const profiler = diagnostics.createStallProfiler({
      continuous: true,
      command: async (name: string) =>
        name === 'Profiler.stop'
          ? {
              profile: {
                startTime: navigated ? 1078000 : 915000,
                endTime: navigated ? 1240000 : 1034000,
                nodes: [
                  {
                    id: 1,
                    callFrame: { functionName: 'sampleHostWork', url: 'app://obsidian.md/app.js' },
                  },
                ],
                samples: navigated ? [] : [1],
                timeDeltas: [85000],
              },
            }
          : {},
      save: async (profile: any) => {
        saved.push(profile)
        order.push('CPU saved')
        return 'sample'
      },
      emit() {},
    })
    profiler.heartbeat(915)
    await profiler.poll(915)
    const stopProfiles = async () => {
      await profiler.close(1034)
      order.push('writer flushed')
    }
    const button = {
      click() {
        order.push('click')
        navigated = true
      },
    }
    const row = {
      querySelector: () => ({ textContent: 'Rebuild vault cache' }),
      querySelectorAll: () => [button],
    }
    const module = { exports: {} }
    runInNewContext(source, {
      module,
      exports: module.exports,
      require: (name: string) =>
        name === 'node:fs'
          ? { writeFileSync() {}, existsSync: () => false }
          : { join: (...x: string[]) => x.join('/') },
      setTimeout: (work: () => Promise<void>) => {
        scheduled = work
      },
      __scaleEmitEvidence() {},
      __scaleCaptureBoundary: async () => {
        order.push('task 968-1033')
        order.push('receipt')
        return { complete: true }
      },
      __scaleSaveInterruptionBoundary: async () => {
        const result = await flushExitEvidence(
          {
            evaluate: (body: string) =>
              runInNewContext(`(async()=>{${body}})()`, {
                __scaleStopProfiles: stopProfiles,
              }),
          },
          true
        )
        expect(result.flushed).toBe(true)
        return result
      },
    })
    await (module.exports as any).clickRebuild(
      { setting: { open() {}, openTabById() {}, modalEl: { querySelectorAll: () => [row] } } },
      {},
      { id, device: '0' },
      'sample.0.reindex.json'
    )
    await scheduled()
    if (!saved.length) await stopProfiles()
    expect(saved[0].startTime).toBe(915000)
    expect(saved[0].samples).toEqual([1])
    expect(order).toEqual([
      'restart acknowledged',
      'task 968-1033',
      'receipt',
      'CPU saved',
      'writer flushed',
      'click',
    ])
    const [task] = await profileSummary(
      [{ event: 'long-task', device: '0', startedAt: 968, durationMs: 65 }],
      [
        { event: 'harness-launch-request', device: '0', at: 0 },
        { event: 'plugin-load-mark', device: '0', name: 'abele:onload-end', at: 20 },
        { event: 'cpu-profile-ready', device: '0', at: 915 },
        { event: 'harness-interruption-boundary', device: '0', at: 1034 },
        {
          event: 'cpu-profile',
          device: '0',
          path: 'sample',
          startedAt: 915,
          endedAt: 1034,
          clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 },
        },
      ],
      async () => saved[0]
    )
    expect(task.profileWindowComplete).toBe(true)
    expect(task.owner).toBe('host-only')
    expect(longTaskVerdict(task).status).toBe('PASS')
  }
)

it('the actual observer receipt hook saves through the shared protocol before returning', async () => {
  const source = await readFile(new URL('./observer.cjs', import.meta.url), 'utf8')
  const start = source.indexOf('globalThis.__scaleSaveInterruptionBoundary =')
  const end = source.indexOf(
    '// eslint-disable-next-line @typescript-eslint/no-require-imports -- Argument-to-digest',
    start
  )
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const rows: any[] = [],
    order: string[] = []
  const context: any = {
    app: {},
    saveInterruptionBoundary: boundary.saveInterruptionBoundary,
    config: { continuousCpu: true, device: '0', profileDirectory: '/sample' },
    emit: (row: any) => {
      rows.push(row)
      order.push(row.event)
    },
    receiptCapture: {
      captureBoundary: async () => {
        order.push('receipt')
        return { at: 1, completedAt: 2, complete: true }
      },
    },
    fs: {
      mkdirSync() {},
      writeFileSync() {
        order.push('receipt file')
      },
    },
    path: { join: (...parts: string[]) => parts.join('/') },
    __scaleStopProfiles: async () => {
      order.push('CPU saved')
    },
    __scaleFlushEvidence: async () => {
      order.push('writer flushed')
      return true
    },
  }
  runInNewContext(source.slice(start, end), context)
  const receipt = await context.__scaleCaptureBoundary('sample-cut')
  expect(receipt.complete).toBe(true)
  expect(receipt.cpuExport).toEqual({ flushed: true, profilerExported: true })
  expect(order).toEqual([
    'receipt',
    'receipt file',
    'writer flushed',
    'harness-interruption-boundary',
    'CPU saved',
    'writer flushed',
    'interruption-cpu-export',
    'writer flushed',
  ])
  expect(rows.every((row) => !('stack' in row) && !('message' in row))).toBe(true)
})

it('closes scope at the interruption boundary and reopens only after a fresh navigation ack and onload', async () => {
  const rows: any[] = [
    { event: 'harness-launch-request', device: '0', at: 0 },
    { event: 'cpu-profile-ready', device: '0', at: 10 },
    { event: 'plugin-load-mark', device: '0', name: 'abele:onload-end', at: 20 },
    { event: 'harness-interruption-boundary', device: '0', at: 1034 },
    { event: 'renderer-navigation', device: '0', at: 1055 },
    { event: 'plugin-load-mark', device: '0', name: 'abele:onload-end', at: 1100 },
  ]
  const task = { event: 'long-task', device: '0', startedAt: 968, durationMs: 65 }
  expect(longTaskScope(task, rows)).toBe('sync')
  expect(longTaskScope({ ...task, startedAt: 1033, durationMs: 100 }, rows)).toBe('sync')
  const [uncovered] = await profileSummary([task], rows, async () => null)
  expect(longTaskVerdict(uncovered).status).toBe('FAIL')
  expect(longTaskScope({ ...task, startedAt: 1034 }, rows)).toBe('teardown')
  expect(longTaskScope({ ...task, startedAt: 1110 }, rows)).toBe('load')
  rows.push({ event: 'cpu-profile-ready', device: '0', at: 1120 })
  expect(longTaskScope({ ...task, startedAt: 1121 }, rows)).toBe('sync')
})

it('does not mistake a rejected CPU stop for a saved capture', async () => {
  const profiler = diagnostics.createStallProfiler({
    continuous: true,
    command: async (name: string) => {
      if (name === 'Profiler.stop') throw new TypeError('private detail')
      return {}
    },
    emit() {},
    save: async () => {
      throw new Error('Must not save')
    },
  })
  profiler.heartbeat(0)
  await profiler.poll(0)
  expect(await profiler.close(100)).toBe(false)
})

it('waits for durable export receipts before allowing the interruption action', async () => {
  const rows: any[] = []
  let permit: () => void = () => {},
    completed = false
  const blocked = new Promise<void>((resolve) => {
    permit = resolve
  })
  const saving = boundary
    .saveInterruptionBoundary({
      id: 'sample-cut',
      now: () => 100,
      emit: (row: any) => rows.push(row),
      stopProfiles: async () => {},
      flushEvidence: async () => {
        await blocked
        return true
      },
    })
    .then((result) => {
      completed = true
      return result
    })
  await new Promise((resolve) => setImmediate(resolve))
  expect(completed).toBe(false)
  expect(rows[0]).toMatchObject({ event: 'harness-interruption-boundary', at: 100 })
  permit()
  expect(await saving).toEqual({ flushed: true, profilerExported: true })
  expect(rows.at(-1)).toMatchObject({ event: 'interruption-cpu-export', flushed: true })
})

it.each(['stop', 'writer', 'missing'])(
  'persists a controlled failure and never claims export (%s)',
  async (mode) => {
    const rows: any[] = []
    const result = await boundary.saveInterruptionBoundary({
      id: 'sample-cut',
      emit: (row: any) => rows.push(row),
      stopProfiles:
        mode === 'missing'
          ? undefined
          : async () => {
              if (mode === 'stop')
                throw new TypeError('Bearer sample-private-value /private/example')
            },
      flushEvidence: async () => mode !== 'writer',
    })
    expect(result.flushed).toBe(false)
    expect(result.profilerExported).not.toBe(true)
    expect(rows.at(-1)).toMatchObject({ event: 'interruption-cpu-export', flushed: false })
    expect(JSON.stringify({ result, rows })).not.toMatch(
      /sample-private-value|Bearer|private\/example|message|stack/
    )
  }
)

it('requires a fresh CPU ack when continuing the same renderer after a pause or network cut', () => {
  const rows = [
    { event: 'harness-launch-request', device: '0', at: 0 },
    { event: 'cpu-profile-ready', device: '0', at: 10 },
    { event: 'plugin-load-mark', device: '0', name: 'abele:onload-end', at: 20 },
    { event: 'harness-interruption-boundary', device: '0', at: 100 },
    { event: 'harness-interruption-resume', device: '0', at: 200 },
  ]
  const task = { device: '0', startedAt: 210, durationMs: 65 }
  expect(longTaskScope(task, rows)).toBe('load')
  rows.push({ event: 'cpu-profile-ready', device: '0', at: 205 })
  expect(longTaskScope(task, rows)).toBe('sync')
  rows.push({ event: 'harness-load-request', device: '0', at: 220 })
  rows.push({ event: 'cpu-profile-ready', device: '0', at: 230 })
  expect(longTaskScope({ ...task, startedAt: 240 }, rows)).toBe('load')
  rows.push({ event: 'plugin-load-mark', device: '0', name: 'abele:onload-end', at: 250 })
  expect(longTaskScope({ ...task, startedAt: 260 }, rows)).toBe('sync')
})
