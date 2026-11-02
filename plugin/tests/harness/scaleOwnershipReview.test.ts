// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { AsyncResource } from 'node:async_hooks'
import asyncHooks from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { allocationAttribution, profileSummary, entryLedgerEvidence } from '../scale/diagnostics.mjs'
import { longTaskVerdict } from '../scale/oracles.mjs'
const require = createRequire(import.meta.url)
const api = require('../scale/entry-ledger.cjs')
const task = { event: 'long-task', device: '0', startedAt: 1000, durationMs: 100 }
const ledgerRows = (end: number) => [
  { event: 'plugin-entry-ledger-ready', device: '0', generation: 'sample', at: 0,
    coverageStartedAt: 0, complete: true },
  { event: 'plugin-entry-start', device: '0', generation: 'sample', id: 1, at: 1000 },
  { event: 'plugin-entry-end', device: '0', generation: 'sample', id: 1, at: end },
  { event: 'plugin-entry-ledger-checkpoint', device: '0', generation: 'sample', at: 1200, complete: true },
]
const cpuCapture = { event: 'cpu-profile', device: '0', startedAt: 0, endedAt: 1200,
  path: 'cpu', clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } }
const heapCapture = { event: 'allocation-profile', device: '0', startedAt: 0, endedAt: 1000,
  complete: true, includeCollected: true, path: 'heap' }
const cpu = (url: string, name = 'work', at = 1050) => ({ startTime: 0, endTime: 1200000,
  nodes: [{ id: 1, callFrame: { functionName: name, url } }],
  samples: [1], timeDeltas: [at * 1000] })
const heap = (url: string) => ({ head: { id: 1, callFrame: { url } },
  samples: [{ nodeId: 1, size: 100, ordinal: 1 }] })

it('review 1: preceding allocations cannot exempt a measured plugin GC task', async () => {
  const [row] = await profileSummary([task], [...ledgerRows(1100), cpuCapture, heapCapture],
    async path => path === 'cpu' ? cpu('', '(garbage collector)') : heap('plugin:scale-observer'))
  expect(row.owner).toBe('ours during sync')
  expect(longTaskVerdict(row).status).toBe('FAIL')
  expect(row.allocationAttribution.splitBytes.harness).toBe(100)
})
it('review 1: a preceding plugin allocation window cannot prove ownership of later root GC', async () => {
  const [row] = await profileSummary([task], [cpuCapture, heapCapture],
    async path => path === 'cpu' ? cpu('', '(garbage collector)') : heap('plugin:abele'))
  expect(row.owner).toBe('unattributed')
  expect(longTaskVerdict(row).status).toBe('FAIL')
})
it('review 2: CPU plugin execution outside a claimed complete entry stays contradictory', async () => {
  const [row] = await profileSummary([task], [...ledgerRows(1010), cpuCapture, heapCapture],
    async path => path === 'cpu' ? cpu('plugin:abele', 'work', 1090) : heap('plugin:scale-observer'))
  expect(row).toMatchObject({ owner: 'unattributed', entryLedgerConflict: true })
  expect(longTaskVerdict(row).status).toBe('FAIL')
})
it('review 2: GC and heap samples cannot erase a CPU/entry contradiction', async () => {
  const [row] = await profileSummary([task], [...ledgerRows(1010), cpuCapture, heapCapture],
    async path => path === 'cpu' ? { startTime: 0, endTime: 1200000,
      nodes: [{ id: 1, callFrame: { functionName: '(garbage collector)', url: '' } },
        { id: 2, callFrame: { functionName: 'work', url: 'plugin:abele' } }],
      samples: [1, 2], timeDeltas: [1080000, 10000] } : heap('app://obsidian.md/app.js'))
  expect(row).toMatchObject({ owner: 'unattributed', entryLedgerConflict: true, gcDominated: true })
  expect(longTaskVerdict(row).status).toBe('FAIL')
})
it('review 2: adjacent entry intervals cover a sample spanning their boundary', async () => {
  const rows = ledgerRows(1050)
  rows.push({ event: 'plugin-entry-start', device: '0', generation: 'sample', id: 2, at: 1050 },
    { event: 'plugin-entry-end', device: '0', generation: 'sample', id: 2, at: 1100 })
  const [row] = await profileSummary([task], [...rows, { ...cpuCapture,
    clock: { beforeAt: 0, afterAt: 4, timestampMs: 0 } }],
  async () => cpu('plugin:abele', 'work', 1048))
  expect(row).toMatchObject({ owner: 'ours during sync', entryLedgerConflict: false })
})
it('review 1: positive measured entries remain evidence when other coverage is partial', async () => {
  const rows = ledgerRows(1100).map(row => row.event === 'plugin-entry-ledger-checkpoint'
    ? { ...row, complete: false } : row)
  const [row] = await profileSummary([task], rows, async () => null)
  expect(row).toMatchObject({ owner: 'ours during sync', entryLedgerComplete: false })
  expect(longTaskVerdict(row).status).toBe('FAIL')
})
it('review 4: explicitly partial host-method coverage cannot prove a host-only task', async () => {
  const rows = ledgerRows(1000)
  rows.push({ event: 'plugin-entry-ledger-partial', device: '0', generation: 'sample',
    at: 900, reason: 'Host methods are not instrumented' } as any)
  const [row] = await profileSummary([task], [...rows, cpuCapture],
    async () => cpu('app://obsidian.md/app.js'))
  expect(row).toMatchObject({ entryLedgerComplete: false, owner: 'unattributed' })
  expect(longTaskVerdict(row).status).toBe('FAIL')
})
it.each([['ours during sync', 90, 20, 50], ['plugin load', 900, 10, 800]])(
  'review 3: budgets the entire %s task', (owner, durationMs, pluginEntryOverlapMs, limit) => {
    expect(longTaskVerdict({ owner, durationMs, entryLedgerComplete: true,
      pluginEntryOverlapMs, withoutTracepointSetupMs: 1 })).toMatchObject({
      durationMs, limit, status: 'FAIL' })
  })
it.each(['registerView', 'registerEditorExtension', 'addSettingTab'])(
  'review 4: unsupported host methods registered through %s make coverage partial', async method => {
    const rows: any[] = []
    class Plugin {
      manifest = { id: 'abele' }
      registerView(_type: string, factory: any) { return factory() }
      registerEditorExtension(value: any) { return value }
      addSettingTab(value: any) { return value }
    }
    const ledger = api.createEntryLedger({ device: '0',
      write: (text: string) => rows.push(...text.trim().split('\n').flatMap(line => api.decodeEntryBatch(JSON.parse(line)))) })
    const close = api.installEntryLedger({ ledger, target: {}, Plugin })
    const plugin = new Plugin()
    ledger.wrap(() => {
      if (method === 'registerView') plugin.registerView('sample', () => ({ setState() {} }))
      else plugin[method]({ update() {}, display() {} })
    }, 'plugin:onload')()
    await close()
    expect(rows.findLast(row => row.event === 'plugin-entry-ledger-checkpoint'))
      .toMatchObject({ complete: false })
    expect(rows.some(row => row.event === 'plugin-entry-ledger-partial')).toBe(true)
    const proof = entryLedgerEvidence({ device: '0', startedAt: Date.now() - 1, durationMs: 1 }, rows)
    expect(proof.complete).toBe(false)
  })
it('review 5: a host allocating helper under a plugin caller is a plugin allocation', async () => {
  const result = await allocationAttribution(task, [heapCapture], async () => ({
    head: { id: 1, callFrame: { url: 'plugin:abele' }, children: [
      { id: 2, callFrame: { url: 'app://obsidian.md/app.js' } },
    ] }, samples: [{ nodeId: 2, size: 128 }] }))
  expect(result.splitBytes).toEqual({ plugin: 128, host: 0, harness: 0, unknown: 0 })
})
it('review 6: nested execution of a real AsyncResource closes both ownership entries', async () => {
  const ledger = api.createEntryLedger({ device: '0', write() {} })
  const close = api.installEntryLedger({ ledger, target: {}, asyncHooks })
  let resource: AsyncResource | undefined
  try {
    ledger.wrap(() => { resource = new AsyncResource('sample') }, 'plugin root')()
    resource!.runInAsyncScope(() => resource!.runInAsyncScope(() => {}))
    expect(ledger.active()).toBe(false)
  } finally { resource?.emitDestroy(); await close() }
})
it('review 7: once removal preserves Node listener identity after an earlier subscription', async () => {
  const ledger = api.createEntryLedger({ device: '0', write() {} })
  const close = api.installEntryLedger({ ledger, target: {}, EventEmitter })
  let calls = 0
  const event = new EventEmitter(), fn = () => { calls++ }
  try {
    ledger.wrap(() => {
      event.on('sample', fn); event.off('sample', fn)
      event.once('sample', fn); event.off('sample', fn)
      event.emit('sample')
    }, 'plugin root')()
    expect(calls).toBe(0)
    expect(event.listenerCount('sample')).toBe(0)
  } finally { await close() }
})
it('review 8: renderer unload flushes entries without stopping the host continuous watch', async () => {
  const source = await readFile(new URL('../scale/observer.cjs', import.meta.url), 'utf8')
  const callbacks: any[] = []
  let stopped = 0, tornDown = 0
  class Plugin { register() {} }
  const config = { entryLedger: 'ledger', continuousCpu: true, profileDirectory: '/sample',
    diagnostics: 'diagnostics', device: '0', failureDiagnostic: 'end-setup' }
  const context: any = { module: { exports: {} }, performance: { mark() {} },
    window: { addEventListener: (_name: string, fn: any) => callbacks.push(fn) },
    __scaleStopProfiles: () => { stopped++ }, require: (name: string) => {
      if (name === 'obsidian') return { Plugin }
      if (name === 'fs') return { readFileSync: () => JSON.stringify(config), mkdirSync() {} }
      if (name === 'path') return { join: (...parts: string[]) => parts.join('/') }
      if (name === 'ledger') return { createEntryLedger: () => ({ teardown() { tornDown++ }, flush() {} }),
        installEntryLedger: () => () => {}, wrapProductExport() {} }
      if (name === '@electron/remote') return { require: () => ({ openEvidencePort: () => 'sample' }),
        getCurrentWebContents: () => ({ id: 1 }) }
      if (name === 'electron') return { ipcRenderer: { send() {} } }
      if (name === 'node:async_hooks' || name === 'node:events') return {}
      throw new Error('end setup')
    } }
  runInNewContext(source, context)
  const observer = new context.module.exports()
  observer.app = { vault: { adapter: { getBasePath: () => '/sample' } } }
  await expect(observer.onload()).rejects.toThrow('end setup')
  callbacks[0]()
  expect(tornDown).toBe(1)
  expect(stopped).toBe(0)
})
