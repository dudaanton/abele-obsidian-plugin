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
