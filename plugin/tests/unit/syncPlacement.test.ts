// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { syncPlacementPlugin } from '../../scripts/sync-placement.mjs'
import { parse } from 'acorn'
import { analyze } from 'eslint-scope'

const root = resolve('node_modules/@abele/sync-sdk')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const paths: string[] = []
it('shares scope ledger walks only while the host proves the same filtered state', async () => {
  const source = sample(version, 'scope.js')
  const code = syncPlacementPlugin().transform(source.input, source.id)?.code ?? source.input
  const method = code.slice(
    code.indexOf('async entries(opts) {'),
    code.indexOf('/** Read afresh each time:')
  )
  const entries = new Function('ScanWork', 'checkCancellation', `return ({${method}}).entries`)(
    class {
      async step() {}
    },
    () => {}
  )
  let revision = 'entries:0:representation:0',
    walks = 0
  const row = { path: 'sample.md' }
  const state = {
    [Symbol.for('abele.sync.scope-state-revision-v1')]: async () => revision,
    async *all() {
      walks++
      yield row
    },
  }
  const scope = { state }
  expect(await entries.call(scope, {})).toEqual([row])
  expect(await entries.call(scope, {})).toEqual([row])
  expect(walks).toBe(1)
  revision = 'entries:1:representation:0'
  await entries.call(scope, {})
  expect(walks).toBe(2)
  revision = 'entries:1:representation:1'
  await entries.call(scope, {})
  expect(walks).toBe(3)
  Reflect.deleteProperty(state, Symbol.for('abele.sync.scope-state-revision-v1'))
  await entries.call(scope, {})
  await entries.call(scope, {})
  expect(walks).toBe(5)
})
it('defers only unchanged host constructor scope inventory and repairs marks in the active cycle', async () => {
  const source = sample(version, 'scope.js')
  const code = syncPlacementPlugin().transform(source.input, source.id)?.code ?? source.input
  const method = code.slice(
    code.indexOf('record(fs, scope,'),
    code.indexOf('    /**\n     * Mark what the scope excludes now, and settle')
  )
  const record = new Function(
    'serially',
    'ScanWork',
    'parseRecord',
    'canonical',
    'isEngineOwn',
    'checkCancellation',
    'SCOPE_KEY',
    `return ({${method}}).record`
  )(
    (_: unknown, run: () => unknown) => run(),
    class {
      async step() {}
    },
    JSON.parse,
    JSON.stringify,
    () => false,
    () => {},
    'marked-scope'
  )
  let walks = 0,
    saved = 0
  const scope = { scriptsFolder: 'Scripts' }
  const state = {
    [Symbol.for('abele.sync.defer-unchanged-scope-v1')]: true,
    getMeta: async () => JSON.stringify(scope),
    setMeta: async () => {},
  }
  const marks = {
    state,
    load: async () => new Set(),
    save: async () => {
      saved++
    },
    entries: async () => {
      walks++
      return [{ fileId: 'sample', wirePath: 'sample.md', size: 1 }]
    },
  }
  const filter = { excluded: () => true }
  await record.call(marks, {}, scope, filter)
  expect(walks).toBe(0)
  await record.call(marks, {}, scope, filter, { signal: new AbortController().signal })
  expect(walks).toBe(1)
  expect(saved).toBe(1)
  Reflect.deleteProperty(state, Symbol.for('abele.sync.defer-unchanged-scope-v1'))
  await record.call(marks, {}, scope, filter)
  expect(walks).toBe(2)
})

it('shares the prepared inventory while its host revision is stable and cancels a racing snapshot', async () => {
  const source = sample(version, 'scanSnapshot.js')
  const code = syncPlacementPlugin().transform(source.input, source.id)?.code ?? source.input
  class Cancelled extends Error {}
  const snapshot = new Function(
    'ScanWork',
    'checkCancellation',
    'SyncCancelled',
    code
      .replace(/^import .*;$/gm, '')
      .replace('export function scanSnapshot', 'return function scanSnapshot')
  )(
    class {
      async step() {}
    },
    () => {},
    Cancelled
  )
  let revision = 0,
    walks = 0,
    race = false
  const fs = {
    [Symbol.for('abele.sync.local-scan-revision-v1')]: () => revision,
    async *list() {
      walks++
      yield { path: 'sample.md' }
      if (race) revision++
    },
  }
  const inventory = snapshot(fs, () => undefined)
  expect(await Array.fromAsync(inventory.fs.list())).toEqual([{ path: 'sample.md' }])
  await Array.fromAsync(inventory.fs.list())
  expect(walks).toBe(1)
  revision++
  await Array.fromAsync(inventory.fs.list())
  expect(walks).toBe(2)
  inventory.invalidate()
  race = true
  await expect(Array.fromAsync(inventory.fs.list())).rejects.toBeInstanceOf(Cancelled)
  race = false
  await Array.fromAsync(inventory.fs.list())
  expect(walks).toBe(4)
})

it('probes remote settlement without consuming changes and rejects head, generation or access changes', async () => {
  const source = sample(version, 'v2Client.js')
  const code = syncPlacementPlugin().transform(source.input, source.id)?.code ?? source.input
  const method = code.slice(
    code.indexOf("async [Symbol.for('abele.sync.inspect-remote-head-v1')]"),
    code.indexOf('    async state() {')
  )
  const probe = new Function(
    'V2ConnectionSchema',
    'V2ChangesSchema',
    `return ({${method}})[Symbol.for('abele.sync.inspect-remote-head-v1')]`
  )({}, {})
  const original = { status: 'active', scope: { path: '/' }, limits: { max_file_bytes: 1000000 } }
  let reply = structuredClone(original),
    head = 4,
    generation = 1
  const queries: unknown[] = []
  const http = {
    generation: 1,
    observedGeneration: 1,
    async json(_schema: unknown, method: string, path: string, options: { query?: unknown }) {
      expect(method).toBe('GET')
      http.observedGeneration = generation
      if (path === '/v2/connection') return reply
      expect(path).toBe('/v2/changes')
      queries.push(options.query)
      return { cursor: head, items: [], next: null }
    },
  }
  const ctx = { http, connectionInfo: original }
  expect(await probe.call(ctx, 4)).toBe(true)
  expect(queries[0]).toEqual({ since: Number.MAX_SAFE_INTEGER, limit: 1 })
  head++
  expect(await probe.call(ctx, 4)).toBe(false)
  head = 4
  generation++
  expect(await probe.call(ctx, 4)).toBe(false)
  generation = 1
  reply = { ...reply, scope: { path: 'Shared' } }
  expect(await probe.call(ctx, 4)).toBe(false)
  reply = { ...structuredClone(original), status: 'revoked' }
  expect(await probe.call(ctx, 4)).toBe(false)
  expect(ctx.connectionInfo).toBe(original)
})

it('leaves the external state module outside the memory-store integration', () => {
  const id = join(root, 'dist/internal/core/external/state.js')
  expect(syncPlacementPlugin().transform(readFileSync(id, 'utf8'), id)).toBeNull()
})

it('yields while indexing scan sources and refreshing unchanged entries', async () => {
  let steps = 0
  class ScanWork {
    async step() {
      steps++
    }
  }
  const scanScheduling = () => ({})
  const hashes = new Map(Array.from({ length: 1024 }, (_, i) => [`sample-${i}.md`, `sha-${i}`]))
  const scan = { hashes, diskPaths: new Map(), dirty: new Set(), infos: new Map() }
  const sources = sample(version, 'pushSources.js')
  const sourceCode = syncPlacementPlugin().transform(sources.input, sources.id)!.code
  const fromScan = new Function(
    'ScanWork',
    'scanScheduling',
    sourceCode.replace(/^import .*;$/gm, '').replaceAll('export ', '') +
      '; return typeof sourcesFromScanCooperative === "function" ? sourcesFromScanCooperative : sourcesFromScan'
  )(ScanWork, scanScheduling)
  await fromScan({}, scan, {})
  expect(steps).toBe(hashes.size)
  steps = 0
  const pusher = sample(version, 'pusher.js')
  const pushCode = syncPlacementPlugin().transform(pusher.input, pusher.id)!.code
  const method = pushCode.slice(
    pushCode.indexOf('async refresh(scan) {'),
    pushCode.indexOf('/* ── Uploads')
  )
  const refresh = new Function('ScanWork', 'scanScheduling', `return ({${method}}).refresh`)(
    ScanWork,
    scanScheduling
  )
  let reads = 0
  await refresh.call(
    {
      state: {
        get: async () => {
          reads++
          return null
        },
      },
    },
    scan
  )
  expect(reads).toBe(hashes.size)
  expect(steps).toBe(hashes.size)
})

it('records direct and queued cycle callers before every run', () => {
  const { id, input } = sample(version, 'engine.js')
  const code = syncPlacementPlugin().transform(input, id)?.code ?? input
  const sync = code.slice(code.indexOf('sync('), code.indexOf('/**\n     * Walk the manifest'))
  const begin = code.slice(code.indexOf('beginRun() {'), code.indexOf('/**\n     * Make `work`'))
  const occupy = code.slice(code.indexOf('occupy(work) {'), code.indexOf("/** A host's job"))
  const log: string[] = []
  const engine = new Function(
    'deferred',
    'noop',
    `return new class {${sync}\n${begin}\n${occupy}}`
  )(
    () => ({ promise: Promise.resolve() }),
    () => {}
  )
  Object.assign(engine, {
    opts: {},
    running: null,
    queued: null,
    cancellation: new AbortController(),
    log: (line: string) => log.push(line),
    run: () => Promise.resolve(),
    launch() {
      return this.beginRun()
    },
  })
  engine.sync('manual')
  engine.running = Promise.resolve()
  engine.sync('events')
  engine.sync('watch')
  engine.beginRun()
  expect(log.filter((line) => line.startsWith('sync: cycle '))).toEqual([
    expect.stringContaining('manual'),
    expect.stringContaining('events, watch'),
  ])
  expect(log.filter((line) => line.startsWith('sync: request '))).toHaveLength(3)
  expect(log.some((line) => line.includes('caller:') && line.includes('syncPlacement.test'))).toBe(
    true
  )
})
it('keeps retained-answer filesystem settlement under the placement lease', () => {
  const { id, input } = sample(version, 'pusher.js')
  const output = syncPlacementPlugin().transform(input, id)!
  expect(output.code).toContain('coordinatePlacement(this.recorder.fs, receiptPaths')
  expect(output.code).toContain('current = await receiptStillCurrent(this.fs, tx, row)')
})
it('binds every transaction capability in transformed startup recovery', () => {
  const { id, input } = sample(version, 'pullRecovery.js')
  const output = syncPlacementPlugin().transform(input, id)!
  const code = typeof output === 'string' ? output : output.code
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', ranges: true })
  const scopes = analyze(ast, { ecmaVersion: 2022, sourceType: 'module' })
  expect(
    scopes.globalScope.through.filter((reference) => reference.identifier.name === 'tx')
  ).toEqual([])
})
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})
function sample(installedVersion = version, module = 'cycle.js') {
  const temp = mkdtempSync(join(tmpdir(), 'sample-placement-'))
  paths.push(temp)
  const pkg = join(temp, 'node_modules/sample/node_modules/@abele/sync-sdk')
  mkdirSync(join(pkg, 'dist/internal/core'), { recursive: true })
  const id = join(pkg, 'dist/internal/core', module)
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: '@abele/sync-sdk', version: installedVersion })
  )
  const input = readFileSync(join(root, 'dist/internal/core', module), 'utf8')
  writeFileSync(id, input)
  return { id, input, temp, pkg }
}
it.each([
  'engine.js',
  'scope.js',
  'watchReports.js',
  'cycle.js',
  'fileRetry.js',
  'state.js',
  'scanner.js',
  'reconciliation.js',
  'pushSources.js',
  'removalRetention.js',
  'localPaths.js',
  'pullRun.js',
  'pullPlace.js',
  'pullRecovery.js',
  'pusher.js',
  'v2Directories.js',
  'v2Client.js',
  'departureSettlement.js',
  'departureMarks.js',
])('passes %s through a second plugin instance and query id unchanged', (module) => {
  const { id, input } = sample(version, module)
  const first = syncPlacementPlugin().transform(input, id)!
  expect(first.code).toContain('abele-sync-placement-v1:')
  expect(syncPlacementPlugin().transform(first.code, id + '?v=sample')).toEqual(first)
})
it('handles a symlinked installation without sharing transform state', () => {
  const { id, input, temp, pkg } = sample()
  const alias = join(temp, 'alias/node_modules/@abele/sync-sdk')
  mkdirSync(join(temp, 'alias/node_modules/@abele'), { recursive: true })
  symlinkSync(pkg, alias)
  const plugin = syncPlacementPlugin()
  expect(plugin.transform(input, join(alias, 'dist/internal/core/cycle.js'))).toEqual(
    plugin.transform(input, id)
  )
})
it('reports a stale nested installation before trying placement boundaries', () => {
  const { id } = sample('0.0.0-stale')
  expect(() => syncPlacementPlugin().transform('', id)).toThrow(
    `installed @abele/sync-sdk 0.0.0-stale does not match the pinned ${version}; run npm ci`
  )
})
it.each([0, 2])('fails closed with the file, boundary and count %i', (count) => {
  const { id, input } = sample()
  const damaged = input.replace('async cycle() {', 'async cycle() {'.repeat(count))
  expect(() => syncPlacementPlugin().transform(damaged, id)).toThrow(
    `Unsupported sync placement boundary in ${id}: "async cycle() {"; found ${count}, expected 1`
  )
})
it('rejects damaged marked output', () => {
  const { id, input } = sample()
  const output = syncPlacementPlugin().transform(input, id)!
  expect(() => syncPlacementPlugin().transform(output.code + '\nchanged', id)).toThrow(/marker/i)
})
it('rejects modified installed bytes even with the pinned version', () => {
  const { id, input } = sample()
  writeFileSync(id, input + '\nchanged')
  expect(() => syncPlacementPlugin().transform(input, id)).toThrow(/integrity.*run npm ci/i)
})

it('delivers structured push refusals before returning the operation verdict', async () => {
  const { id, input } = sample(version, 'pushRefusal.js')
  const output = syncPlacementPlugin().transform(input, id)
  expect(output).not.toBeNull()
  const make = new Function(
    output!.code.replace('export async function', 'async function') + '; return rejectedOp'
  )()
  const received: unknown[] = []
  const state = { [Symbol.for('abele.sync.push-refusal-v1')]: (row: unknown) => received.push(row) }
  const row = await make(
    state,
    { op: 'create', path: 'Notes/sample.bin', size: 12 },
    { code: 'too_large', message: 'limit', details: { max_bytes: 8 } }
  )
  expect(received).toEqual([row])
  expect(row).toMatchObject({ path: 'Notes/sample.bin', size: 12, limit: 8 })
})
