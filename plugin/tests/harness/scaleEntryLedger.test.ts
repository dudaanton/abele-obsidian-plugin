// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { profileSummary, readEntryLedger } from '../scale/diagnostics.mjs'
import { longTaskVerdict } from '../scale/oracles.mjs'
import asyncHooks from 'node:async_hooks'
import { EventEmitter } from 'node:events'
const require = createRequire(import.meta.url)
const decode = (text: string) => text.trim().split("\n").map(JSON.parse)
  .flatMap(row => require("../scale/entry-ledger.cjs").decodeEntryBatch(row))

const coverage = [
  { event: 'plugin-entry-ledger-ready', device: '0', generation: 'sample', at: 0,
    coverageStartedAt: 0, pluginAbsent: true, complete: true },
  { event: 'plugin-entry-ledger-checkpoint', device: '0', generation: 'sample', at: 200,
    complete: true },
]
it('keeps colliding live async IDs separate and closes their ownership roots', async () => {
  const { createEntryLedger, installEntryLedger } = require('../scale/entry-ledger.cjs')
  const rows: any[] = []
  let hook: any
  const ledger = createEntryLedger({ device: '0',
    write: (text: string) => rows.push(...decode(text)) })
  const close = installEntryLedger({ ledger, target: {}, asyncCapacity: 8,
    asyncHooks: { createHook(callbacks: any) {
      hook = callbacks
      return { enable() {}, disable() {} }
    } } })
  const root = ledger.begin('sample root')
  hook.init(1, 'PROMISE')
  ledger.end(root)
  hook.before(1)
  hook.init(262145, 'PROMISE') // Same slot in the previous direct-mapped table.
  hook.init(9, 'PROMISE')
  hook.after(1)
  expect(ledger.active()).toBe(false)
  hook.destroy(1)
  for (const id of [262145, 9]) {
    hook.before(id)
    expect(ledger.active()).toBe(true)
    hook.after(id)
    expect(ledger.active()).toBe(false)
    hook.destroy(id)
  }
  // A later host resource must not inherit leaked product ownership.
  hook.init(17, 'PROMISE')
  hook.before(17)
  expect(ledger.active()).toBe(false)
  hook.after(17)
  await close()
  expect(rows.findLast(row => row.event === 'plugin-entry-ledger-checkpoint'))
    .toMatchObject({ complete: true, dropped: 0 })
})
it('fails closed on actual async table exhaustion without overwriting active entries', async () => {
  const { createEntryLedger, installEntryLedger } = require('../scale/entry-ledger.cjs')
  const rows: any[] = []
  let hook: any
  const ledger = createEntryLedger({ device: '0',
    write: (text: string) => rows.push(...decode(text)) })
  const close = installEntryLedger({ ledger, target: {}, asyncCapacity: 4,
    asyncHooks: { createHook(callbacks: any) {
      hook = callbacks
      return { enable() {}, disable() {} }
    } } })
  const root = ledger.begin('sample root')
  for (const id of [1, 5, 9, 13, 17]) hook.init(id, 'PROMISE')
  ledger.end(root)
  hook.destroy(5)
  for (const id of [1, 9, 13]) {
    hook.before(id)
    expect(ledger.active()).toBe(true)
    hook.after(id)
    expect(ledger.active()).toBe(false)
  }
  hook.before(17)
  expect(ledger.active()).toBe(false)
  await close()
  expect(rows.findLast(row => row.event === 'plugin-entry-ledger-checkpoint'))
    .toMatchObject({ complete: false, dropped: 1 })
})
it('keeps callback recording in a fixed ring without exporting on the call path', async () => {
  const { createEntryLedger } = require('../scale/entry-ledger.cjs')
  const rows: any[] = []
  let now = 0
  const ledger = createEntryLedger({ write: (text: string) => rows.push(...decode(text)),
    device: '0', now: () => now, performance: { now: () => now, timeOrigin: 0 } })
  const callback = ledger.wrap(function (value: number) { now += 3; return value }, 'sample')
  const before = rows.length
  now = 1000
  for (let i = 0; i < 300; i++) expect(callback(i)).toBe(i)
  expect(rows).toHaveLength(before)
  await ledger.close()
  expect(rows.filter(row => row.event === 'plugin-entry-start')).toHaveLength(300)
})
it('records wrapper self-time separately and marks ring overflow incomplete', async () => {
  const { createEntryLedger } = require('../scale/entry-ledger.cjs')
  const rows: any[] = []
  let now = 0
  const ledger = createEntryLedger({ capacity: 16, write: (text: string) => rows.push(...decode(text)),
    device: '0', now: () => ++now, performance: { now: () => now, timeOrigin: 0 } })
  const callback = ledger.wrap(() => {}, 'sample')
  for (let i = 0; i < 20; i++) callback()
  await ledger.close()
  expect(rows.some(row => row.event === 'plugin-entry-ledger-overhead' && row.endedAt > row.startedAt)).toBe(true)
  expect(rows.findLast(row => row.event === 'plugin-entry-ledger-checkpoint')).toMatchObject({ complete: false })
  expect(rows.findLast(row => row.event === 'plugin-entry-ledger-checkpoint').dropped).toBeGreaterThan(0)
})
it('reports wrapper self-time without filling missing CPU coverage', async () => {
  const [task] = await profileSummary([{ event: 'long-task', device: '0', startedAt: 0,
    durationMs: 53 }], [...coverage,
    { event: 'plugin-entry-start', device: '0', generation: 'sample', id: 1, at: 0 },
    { event: 'plugin-entry-end', device: '0', generation: 'sample', id: 1, at: 53 },
    { event: 'plugin-entry-ledger-overhead', device: '0', generation: 'sample',
      kind: 'wrapper self-time', startedAt: 0, endedAt: 53 },
  ], async () => null)
  expect(task).toMatchObject({ owner: 'unattributed', pluginEntryOverlapMs: 0,
    entryLedgerWrapperMs: 53, entryLedgerExportMs: 0 })
  expect(longTaskVerdict(task).status).toBe('FAIL')
})
it('does not exempt lifecycle tasks without a harness stop receipt or CPU coverage', async () => {
  const rows = await profileSummary([{ event: 'long-task', device: '0', startedAt: 10,
    durationMs: 90 }], [...coverage, { event: 'renderer-lifecycle', device: '0',
      generation: 'sample', kind: 'teardown', at: 0 }], async () => null)
  expect(rows[0].owner).toBe('unattributed')
  expect(longTaskVerdict(rows[0]).status).toBe('FAIL')
})
it('reports spanning entry time but missing CPU coverage still fails', async () => {
  const entries = [
    { event: 'plugin-entry-start', device: '0', generation: 'sample', id: 1, at: 0 },
    { event: 'plugin-entry-end', device: '0', generation: 'sample', id: 1, at: 160 },
  ]
  const [row] = await profileSummary([{ event: 'long-task', device: '0', startedAt: 10,
    durationMs: 90 }], [...coverage, ...entries], async () => null)
  expect(row.owner).toBe('unattributed')
  expect(row.pluginEntryOverlapMs).toBe(90)
  expect(longTaskVerdict(row).status).toBe('FAIL')
})
it('does not treat absent ledger coverage as proof of host ownership', async () => {
  const [row] = await profileSummary([{ event: 'long-task', device: '0', startedAt: 10,
    durationMs: 90 }], [], async () => null)
  expect(row.owner).toBe('unattributed')
})
it('uses definite plugin CPU evidence despite contradictory ledger', async () => {
  const captures = [...coverage, { event: 'cpu-profile', device: '0', startedAt: 0,
    endedAt: 100, path: 'sample', clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } }]
  const [row] = await profileSummary([{ event: 'long-task', device: '0', startedAt: 0,
    durationMs: 100 }], captures, async () => ({ startTime: 0, endTime: 100000,
      nodes: [{ id: 1, callFrame: { functionName: 'sample', url: 'plugin:abele' } }],
      samples: [1], timeDeltas: [50000] }))
  // 2026-11-07: 50 ms inclusive plugin samples pass, even in a longer task.
  // The contradictory ledger must not erase either the samples or the conflict.
  expect(row).toMatchObject({ owner: 'host task with our code ≤ budget',
    ourSampledMs: 50, ourSampleCount: 1, samplesBySource: { abele: 1 } })
  expect(row.entryLedgerConflict).toBe(true)
})
it('does not use a damaged ledger to prove absence of plugin entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-entry-'))
  try {
    const file = join(directory, 'ledger.jsonl')
    await writeFile(file, [JSON.stringify(coverage[0]), 'damaged record',
      JSON.stringify(coverage[1])].join('\n'))
    const rows = await readEntryLedger(file, [])
    const [task] = await profileSummary([{ event: 'long-task', device: '0',
      startedAt: 10, durationMs: 90 }], [...rows, { event: 'renderer-lifecycle',
        device: '0', generation: 'sample', kind: 'teardown', at: 0 }], async () => null)
    expect(task.owner).toBe('unattributed')
  } finally { await rm(directory, { recursive: true }) }
})
it('reports entry overlap but budgets the whole task containing plugin execution', async () => {
  const entries = [
    { event: 'plugin-entry-start', device: '0', generation: 'sample', id: 1, at: 20 },
    { event: 'plugin-entry-end', device: '0', generation: 'sample', id: 1, at: 40 },
    { event: 'plugin-entry-start', device: '0', generation: 'sample', id: 2, at: 25 },
    { event: 'plugin-entry-end', device: '0', generation: 'sample', id: 2, at: 35 },
  ]
  const [row] = await profileSummary([{ event: 'long-task', device: '0', startedAt: 10,
    durationMs: 90 }], [...coverage, ...entries], async () => null)
  expect(row.pluginEntryOverlapMs).toBe(20)
  expect(longTaskVerdict(row)).toMatchObject({ status: 'FAIL', durationMs: 90 })
})
it('applies the load budget to the whole task including host loading work', () => {
  expect(longTaskVerdict({ owner: 'plugin load', durationMs: 1600,
    entryLedgerComplete: true, pluginEntryOverlapMs: 600 }).status).toBe('FAIL')
  expect(longTaskVerdict({ owner: 'plugin load', durationMs: 1600,
    entryLedgerComplete: true, pluginEntryOverlapMs: 900 }).status).toBe('FAIL')
})
it('does not charge a synchronous ledger flush to the entered callback', () => {
  const { createEntryLedger } = require('../scale/entry-ledger.cjs')
  const rows: any[] = []
  let now = 0
  const ledger = createEntryLedger({ write: (text: string) => {
    rows.push(...decode(text)); now += 200
  }, device: '0', now: () => now, performance: { now: () => now, timeOrigin: 0 } })
  now = 1000
  ledger.wrap(() => { now += 10 }, 'sample')()
  ledger.close()
  const start = rows.find(row => row.event === 'plugin-entry-start')
  const end = rows.find(row => row.event === 'plugin-entry-end')
  expect(end.at - start.at).toBe(10)
})
it('subtracts nested ledger I/O but requires CPU evidence to exempt a flush', async () => {
  const entries = [
    { event: 'plugin-entry-start', device: '0', generation: 'sample', id: 1, at: 0 },
    { event: 'plugin-entry-end', device: '0', generation: 'sample', id: 1, at: 150 },
    { event: 'plugin-entry-ledger-overhead', device: '0', generation: 'sample', startedAt: 10, endedAt: 140 },
  ]
  const [row] = await profileSummary([{ event: 'long-task', device: '0', startedAt: 10,
    durationMs: 100 }], [...coverage, ...entries], async () => null)
  expect(row.pluginEntryOverlapMs).toBe(0)
  expect(row.owner).toBe('unattributed')
  expect(longTaskVerdict(row).status).toBe('FAIL')
})
it('does not exempt ledger flushes or remainders without CPU coverage', async () => {
  const task = { event: 'long-task', device: '0', startedAt: 0, durationMs: 195 }
  const flush = (endedAt: number) => ({ event: 'plugin-entry-ledger-overhead',
    device: '0', generation: 'sample', startedAt: 0, endedAt })
  const [almostAllFlush] = await profileSummary([task], [...coverage, flush(194)], async () => null)
  expect(almostAllFlush.entryLedgerOverheadMs).toBe(194)
  expect(almostAllFlush.owner).toBe('unattributed')
  expect(longTaskVerdict(almostAllFlush).status).toBe('FAIL')

  const [unexplainedRemainder] = await profileSummary([task], [...coverage, flush(120)], async () => null)
  expect(unexplainedRemainder.owner).toBe('unattributed')
  expect(longTaskVerdict(unexplainedRemainder).status).toBe('FAIL')
  const [shortUnexplainedRemainder] = await profileSummary([task], [...coverage, flush(175)], async () => null)
  expect(shortUnexplainedRemainder.owner).toBe('unattributed')
  expect(longTaskVerdict(shortUnexplainedRemainder).status).toBe('FAIL')

  const [pluginRemainder] = await profileSummary([task], [...coverage, flush(120),
    { event: 'plugin-entry-start', device: '0', generation: 'sample', id: 1, at: 0 },
    { event: 'plugin-entry-end', device: '0', generation: 'sample', id: 1, at: 195 },
  ], async () => null)
  expect(pluginRemainder.pluginEntryOverlapMs).toBe(75)
  expect(longTaskVerdict(pluginRemainder).status).toBe('FAIL')
})
it('retains plugin CPU ownership despite conflicting ledger export evidence', async () => {
  const captures = [...coverage,
    { event: 'plugin-entry-ledger-overhead', device: '0', generation: 'sample',
      startedAt: 0, endedAt: 143 },
    { event: 'cpu-profile', device: '0', startedAt: 0, endedAt: 150, path: 'sample',
      clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } },
  ]
  const [row] = await profileSummary([{ event: 'long-task', device: '0', startedAt: 0,
    durationMs: 143 }], captures, async () => ({ startTime: 0, endTime: 150000,
      nodes: [{ id: 1, callFrame: { functionName: 'sample', url: 'plugin:abele' } }],
      samples: [1], timeDeltas: [50000] }))
  expect(row.entryLedgerConflict).toBe(true)
  // The 143 ms host task contains 50 ms of definite plugin samples. Under the
  // owner's sampled-time rule this passes, without subtracting ledger export time.
  expect(row).toMatchObject({ owner: 'host task with our code ≤ budget',
    ourSampledMs: 50, ourSampleCount: 1, samplesBySource: { abele: 1 } })
  expect(longTaskVerdict(row).status).toBe('PASS')
})
it('drains entry start and completion through the asynchronous sink at quit', async () => {
  const { createEntryLedger } = require('../scale/entry-ledger.cjs')
  const directory = await mkdtemp(join(tmpdir(), 'sample-entry-'))
  const file = join(directory, 'ledger.jsonl')
  let now = 0
  try {
    const ledger = createEntryLedger({ file, device: '0', now: () => now,
      performance: { now: () => now, timeOrigin: 0 }, generation: 'sample' })
    const callback = ledger.wrap(() => { now = 80 }, 'vault event')
    callback()
    ledger.teardown()
    await ledger.close()
    const rows = decode(await readFile(file, 'utf8'))
    expect(rows.find(row => row.event === 'plugin-entry-start')?.at).toBe(0)
    expect(rows.find(row => row.event === 'plugin-entry-end')?.at).toBe(80)
    expect(rows.findLast(row => row.event === 'plugin-entry-ledger-checkpoint')?.complete).toBe(true)
  } finally { await rm(directory, { recursive: true }) }
})
it('wraps host registration callbacks, promise callbacks and lifecycle', () => {
  const { createEntryLedger, installEntryLedger } = require('../scale/entry-ledger.cjs')
  const rows: any[] = []
  let now = 0
  const ledger = createEntryLedger({ write: (text: string) => rows.push(...decode(text)),
    device: '0', now: () => now, performance: { now: () => now, timeOrigin: 0 } })
  const callbacks: any[] = []
  class Events { on(_name: string, fn: any) { callbacks.push(fn); return fn } }
  class Component { manifest = { id: 'abele' }; onload() { now += 10 }; load() { this.onload() } }
  const target: any = { setTimeout(fn: any) { callbacks.push(fn) }, Promise: class { then(fn: any) { callbacks.push(fn) } } }
  const close = installEntryLedger({ ledger, target, Events, Component, isPluginCaller: () => true })
  new Events().on('changed', () => { now += 10 })
  target.setTimeout(() => { now += 10 })
  new target.Promise().then(() => { now += 10 })
  for (const callback of callbacks) callback()
  new Component().load()
  close()
  expect(rows.filter(row => row.event === 'plugin-entry-start')).toHaveLength(4)
  expect(rows.filter(row => row.event === 'plugin-entry-end')).toHaveLength(4)
})
it('records native async await continuations that bypass then wrappers', async () => {
  const { createEntryLedger, installEntryLedger } = require('../scale/entry-ledger.cjs')
  const rows: any[] = []
  const ledger = createEntryLedger({ write: (text: string) => rows.push(...decode(text)),
    device: '0' })
  const close = installEntryLedger({ ledger, target: {}, asyncHooks, isPluginCaller: () => false })
  try {
    await ledger.wrap(async () => { await Promise.resolve(); await Promise.resolve() }, 'entry')()
  } finally { close() }
  expect(rows.filter(row => row.kind === 'async continuation').length).toBeGreaterThan(0)
})
it('propagates root ownership without caller stacks and fails closed on async table exhaustion', () => {
  const { createEntryLedger, installEntryLedger } = require('../scale/entry-ledger.cjs')
  const rows: any[] = [], callbacks: any[] = []
  let hooks: any
  class Events { on(_name: string, fn: any) { callbacks.push(fn) } }
  const ledger = createEntryLedger({ write: (text: string) => rows.push(...decode(text)), device: '0' })
  const close = installEntryLedger({ ledger, target: {}, Events, asyncCapacity: 1,
    asyncHooks: { createHook(value: any) { hooks = value; return { enable() {}, disable() {} } } } })
  ledger.wrap(() => new Events().on('changed', () => {
    hooks.init(1, 'PROMISE'); hooks.init(262145, 'PROMISE')
  }), 'plugin evaluation')()
  callbacks[0]()
  close()
  expect(rows.filter(row => row.event === 'plugin-entry-start')).toHaveLength(2)
  expect(rows.findLast(row => row.event === 'plugin-entry-ledger-checkpoint')?.complete).toBe(false)
})
it('covers direct host construction and onload calls without Component.load', async () => {
  const { createEntryLedger, installEntryLedger, wrapProductExport } = require('../scale/entry-ledger.cjs')
  const rows: any[] = [], callbacks: any[] = []
  class Events { on(_name: string, fn: any) { callbacks.push(fn) } }
  const ledger = createEntryLedger({ write: (text: string) => rows.push(...decode(text)), device: '0' })
  const close = installEntryLedger({ ledger, target: {}, Events, asyncHooks })
  class Product {
    constructor() { new Events().on('constructed', () => {}) }
    async onload() { await Promise.resolve(); new Events().on('changed', () => {}) }
    onunload() {}
  }
  try {
    const namespace = wrapProductExport({ default: Product }, ledger)
    const plugin = new namespace.default()
    expect(plugin).toBeInstanceOf(Product)
    await plugin.onload()
    for (const callback of callbacks) callback()
    plugin.onunload()
  } finally { await close() }
  const kinds = rows.filter(row => row.event === 'plugin-entry-start').map(row => row.kind)
  expect(kinds).toContain('plugin construction')
  expect(kinds).toContain('plugin:onload')
  expect(kinds).toContain('plugin:onunload')
  expect(kinds).toContain('async continuation')
  expect(kinds.filter(kind => kind === 'on')).toHaveLength(2)
})
it('does not declare complete product-root coverage before the export bridge acknowledges', async () => {
  const { createEntryLedger, wrapProductExport } = require('../scale/entry-ledger.cjs')
  const rows: any[] = []
  const ledger = createEntryLedger({ requireProductBridge: true,
    write: (text: string) => rows.push(...decode(text)), device: '0' })
  expect(rows.find(row => row.event === 'plugin-entry-ledger-ready')?.complete).toBe(false)
  expect(ledger.productBridgeReady()).toBe(false)
  await ledger.flush()
  expect(rows.findLast(row => row.event === 'plugin-entry-ledger-checkpoint')?.complete).toBe(false)
  wrapProductExport({ default: class Product { onload() {} } }, ledger)
  expect(ledger.productBridgeReady()).toBe(true)
  await ledger.close()
  expect(rows.findLast(row => row.event === 'plugin-entry-ledger-ready')?.complete).toBe(true)
})
it('wraps native event subscriptions while preserving once and removal', () => {
  const { createEntryLedger, installEntryLedger } = require('../scale/entry-ledger.cjs')
  const rows: any[] = []
  class SampleEmitter extends EventEmitter {}
  const ledger = createEntryLedger({ write: (text: string) => rows.push(...decode(text)), device: '0' })
  const close = installEntryLedger({ ledger, target: {}, EventEmitter: SampleEmitter, isPluginCaller: () => true })
  const emitter = new SampleEmitter()
  let called = 0
  const callback = () => { called++ }
  emitter.once('sample', callback)
  emitter.emit('sample'); emitter.emit('sample')
  emitter.on('sample', callback)
  emitter.off('sample', callback)
  emitter.emit('sample')
  close()
  expect(called).toBe(1)
  expect(rows.some(row => row.event === 'plugin-entry-start')).toBe(true)
})
it('preserves DOM listener removal and wraps request property callbacks', () => {
  const { createEntryLedger, installEntryLedger } = require('../scale/entry-ledger.cjs')
  const rows: any[] = []
  const ledger = createEntryLedger({ write: (text: string) => rows.push(...decode(text)), device: '0' })
  let listener: any, removed: any, requestCallback: any
  class EventTarget {
    addEventListener(_name: string, fn: any) { listener = fn }
    removeEventListener(_name: string, fn: any) { removed = fn }
  }
  class IDBRequest { set onsuccess(fn: any) { requestCallback = fn } }
  const close = installEntryLedger({ ledger, target: { EventTarget, IDBRequest }, isPluginCaller: () => true })
  const callback = () => {}
  const target = new EventTarget()
  target.addEventListener('changed', callback)
  target.removeEventListener('changed', callback)
  new IDBRequest().onsuccess = callback
  listener(); requestCallback()
  close()
  expect(listener).toBe(removed)
  expect(rows.filter(row => row.event === 'plugin-entry-start')).toHaveLength(2)
})
