// @vitest-environment node
import { expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import diagnostics from '../scale/diagnostics.cjs'
import { gcTaskEvidence, profileSummary } from '../scale/diagnostics.mjs'

it('streams only controlled renderer GC intervals and awaits tracing completion', async () => {
  const transport: any = new EventEmitter(), rows: any[] = [], commands: any[] = []
  transport.sendCommand = async (name: string, params: any) => {
    commands.push([name, params])
    if (name === 'Tracing.end') queueMicrotask(() => transport.emit('message', {}, 'Tracing.tracingComplete', {}))
  }
  const trace = diagnostics.createGcTrace({ transport, emit: (row: any) => rows.push(row),
    clock: { beforeAt: 1000, afterAt: 1002, timestampMs: 100 }, rendererPid: 7 })
  await trace.start()
  transport.emit('message', {}, 'Tracing.dataCollected', { value: [
    { name: 'thread_name', ph: 'M', pid: 7, tid: 1, args: { name: 'CrRendererMain' } },
    { name: 'MajorGC', ph: 'X', pid: 7, tid: 1, ts: 110000, dur: 20000,
      args: { usedHeapSizeBefore: 100, usedHeapSizeAfter: 40, secret: 'never-persist' } },
    { name: 'MajorGC', ph: 'X', pid: 8, tid: 1, ts: 110000, dur: 20000 },
    { name: 'EvaluateScript', ph: 'X', pid: 7, ts: 110000, dur: 20000 },
  ] })
  await trace.close()
  expect(rows.filter(row => row.event === 'gc-trace-interval')).toEqual([
    expect.objectContaining({ type: 'MajorGC', startedAt: 1011, durationMs: 20,
      clockUncertaintyMs: 1, heapBefore: 100, heapAfter: 40 }),
  ])
  expect(JSON.stringify(rows)).not.toContain('never-persist')
  expect(rows.at(-1)).toMatchObject({ event: 'gc-trace-end', complete: true })
  expect(commands[0][1].categories).not.toContain('cpu_profiler')
})

it('unions nested GC and samples instead of double counting; missing trace is unknown', () => {
  const task = { device: 1, startedAt: 100, durationMs: 100 }
  const rows = [40, 20].map(durationMs => ({ event: 'gc-trace-interval', device: 1,
    startedAt: 120, durationMs, type: 'MajorGC', heapBefore: 100, heapAfter: 40 }))
  expect(gcTaskEvidence(task, rows, [[100, 130]])).toMatchObject({
    gcMs: 40, sampledOrGcMs: 60, unexplainedMs: 40,
  })
  expect(gcTaskEvidence(task, [], [])).toMatchObject({ gcMs: null, unexplainedMs: 100 })
})

it('records a controlled rejection and never stores the debugger error', async () => {
  const transport: any = new EventEmitter(), rows: any[] = []
  transport.sendCommand = async () => { throw new Error('secret-token-in-exec') }
  const trace = diagnostics.createGcTrace({ transport, emit: (r: any) => rows.push(r),
    clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 }, rendererPid: 1 })
  await trace.start()
  await trace.close()
  expect(rows).toEqual([{ event: 'gc-trace-unavailable', kind: 'start-rejected' }])
  expect(transport.listenerCount('message')).toBe(0)
})

it('handles begin/end across batches and late thread metadata; export timeout is incomplete', async () => {
  const transport: any = new EventEmitter(), rows: any[] = []
  transport.sendCommand = async () => ({})
  const trace = diagnostics.createGcTrace({ transport, emit: (r: any) => rows.push(r),
    clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 }, rendererPid: 1, timeoutMs: 1 })
  await trace.start()
  for (const value of [
    [{ pid: 1, tid: 2, name: 'MinorGC', ph: 'B', ts: 1000 }],
    [{ pid: 1, tid: 2, name: 'MinorGC', ph: 'E', ts: 4000 }],
    [{ pid: 1, tid: 2, name: 'thread_name', ph: 'M', args: { name: 'CrRendererMain' } }],
  ]) transport.emit('message', {}, 'Tracing.dataCollected', { value })
  await trace.close()
  expect(rows[1]).toMatchObject({ event: 'gc-trace-interval', durationMs: 3 })
  expect(rows.at(-1)).toMatchObject({ event: 'gc-trace-end', complete: false, kind: 'export-unavailable' })
})

it('exact GC report data never fills missing CPU coverage or changes ownership', async () => {
  const task = { event: 'long-task', device: 1, startedAt: 100, durationMs: 65 }
  const gc = { event: 'gc-trace-interval', device: 1, startedAt: 100, durationMs: 65, type: 'MajorGC' }
  const [without] = await profileSummary([task], [], async () => null)
  const [withGc] = await profileSummary([task], [gc], async () => null)
  expect(withGc.owner).toBe(without.owner)
  expect(withGc.attributionPass).toBe(false)
  expect(withGc.gcEvidence).toMatchObject({ gcMs: 65, unexplainedMs: 0, reportOnly: true })
})
