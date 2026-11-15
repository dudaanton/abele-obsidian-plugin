// @vitest-environment node
import { expect, it } from 'vitest'
import { build, transform } from 'esbuild'
import { Session } from 'node:inspector'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { SourceMapConsumer } from 'source-map-js'
import { hashTracepoints, hashTracepointBoundary, javascriptHashEvidence } from './reindex.mjs'
const require = createRequire(import.meta.url)
const capture = require('./receipt-capture.cjs')
const diagnostics = require('./diagnostics.cjs')
const reindex = require('./reindex.cjs')
const { SHA256 } = require('@noble/hashes/sha2.js')

it.each([undefined, false, true])(
  'publishes actual test ports only for an instrumented load (%s)',
  async (required) => {
    const built = await build({
      entryPoints: [new URL('../../src/testing/scaleDiagnostics.ts', import.meta.url).pathname],
      bundle: true,
      minify: true,
      write: false,
      format: 'cjs',
      plugins: [
        {
          name: 'sample-host',
          setup(api) {
            api.onResolve({ filter: /^@\/sync\// }, (args) => ({
              path: args.path,
              namespace: 'sample-host',
            }))
            const stubs: Record<string, string> = {
              '@/sync/vaultWrites': 'export const storageOf = app => app.storage;',
              '@/sync/hostSyncStorage': 'export const durableHostOf = storage => storage.host;',
              '@/sync/boundedVaultIo': 'export class BoundedVaultIo {}',
              '@/sync/ObsidianFileSystem': 'export class ObsidianFileSystem {}',
            }
            api.onLoad({ filter: /.*/, namespace: 'sample-host' }, args => {
              if (!stubs[args.path]) throw new Error('Unexpected sample host dependency')
              return { contents: stubs[args.path] }
            })
          },
        },
      ],
    })
    const context: any = { module: { exports: {} }, __scaleEntryLedgerRequired: required }
    context.window = context
    runInNewContext(built.outputFiles[0].text, context)
    context.module.exports.exposeScaleDiagnostics()
    const ports = context.__abeleScaleDiagnosticPorts
    if (required !== true) expect(ports).toBeUndefined()
    else {
      const host = {}
      expect(ports.hostOf({ storage: { host } })).toBe(host)
      expect(ports.hostOf({})).toBeUndefined()
      expect(ports.fingerprintClasses).toHaveLength(2)
      expect(new ports.hashConstructors[0]().digest()).toHaveLength(32)
    }
  }
)

it('installs receipt, fingerprint and real hash ports after minification without lexical binding names', async () => {
  const { code } = await transform(
    `
    globalThis.__abeleScaleDiagnosticPorts = {
      hostOf: application => application.host,
      fingerprintClasses: [class {}, class {}],
      hashConstructors: [ActualSHA256]
    };
  `,
    { minify: true }
  )
  const warmed: Array<() => void> = [],
    wrapped: unknown[] = []
  const context: any = {
    ActualSHA256: SHA256,
    __scaleWrapFingerprints: (value: unknown) => wrapped.push(value),
    __scaleWarmHashConstructors: (work: () => void) => warmed.push(work),
  }
  const installed = capture.instrumentReceiptAccess(code)
  runInNewContext(installed, context)
  const host = {}
  expect(context.__scaleReceiptHost({ host })).toBe(host)
  expect(wrapped).toHaveLength(2)
  expect(warmed).toHaveLength(1)
  expect(() => warmed[0]()).not.toThrow()
  expect(() => hashTracepointBoundary(installed)).not.toThrow()
})

it('rejects an absent or incomplete diagnostic seam instead of losing coverage', () => {
  expect(() => capture.instrumentReceiptAccess('module.exports = {};')).toThrow()
  const context = { __abeleScaleDiagnosticPorts: { hostOf() {} } }
  expect(() =>
    runInNewContext(
      capture.instrumentReceiptAccess(
        'globalThis.__abeleScaleDiagnosticPorts = globalThis.__abeleScaleDiagnosticPorts;'
      ),
      context
    )
  ).toThrow()
})

async function minifiedHash() {
  const source = `class Base {}
export class HashMD extends Base {
  constructor() {
    super();
    this.finished = false;
  }
  update(value) { return value; }
}
export class SHA256 extends HashMD {
  constructor() { super(); }
  digest() { return new Uint8Array(32); }
}`
  const built = await transform(source, {
    minify: true,
    sourcemap: 'external',
    sourcefile: '../node_modules/@noble/hashes/esm/_md.js',
    format: 'cjs',
  })
  return { source, ...built, map: JSON.parse(built.map) }
}

it('locates every post-super hash constructor statement by exact map, including its generated column', async () => {
  const built = await minifiedHash()
  expect(built.code).not.toContain('class HashMD')
  const points = hashTracepoints(built.code, built.map)
  expect(points).toHaveLength(1)
  expect(points[0].columnNumber).toBeGreaterThan(0)
  const original = new SourceMapConsumer(built.map).originalPositionFor({
    line: points[0].lineNumber + 1,
    column: points[0].columnNumber,
  })
  expect(original.line).toBe(5)
  expect(() => hashTracepoints(built.code, { ...built.map, mappings: '' })).toThrow()
})

it('arms exact columns in the correct script without evaluating paused JavaScript', async () => {
  let listener: any
  const commands: any[] = []
  const transport = {
    on: (_: string, callback: any) => {
      listener = callback
    },
    removeListener() {},
    sendCommand: async (name: string, params: any) => {
      commands.push({ name, params })
      return { breakpointId: name === 'Debugger.setBreakpointByUrl' ? 'gate' : 'hash' }
    },
  }
  const location = { lineNumber: 0, columnNumber: 48 }
  const boundary = { lineNumber: 3, columnNumber: 0 }
  await diagnostics.armHashTracepoints(transport, [location], boundary, () => {})
  expect(commands.find((c) => c.name === 'Debugger.setBreakpointByUrl').params).toMatchObject(
    boundary
  )
  await listener(null, 'Debugger.paused', {
    hitBreakpoints: ['gate'],
    callFrames: [{ location: { scriptId: 'sample-bundle' } }],
  })
  expect(commands.find((c) => c.name === 'Debugger.setBreakpoint').params.location).toEqual({
    scriptId: 'sample-bundle',
    ...location,
  })
  expect(commands.at(-1).name).toBe('Debugger.resume')
  expect(commands.some((c) => c.name === 'Debugger.evaluateOnCallFrame')).toBe(false)
})

it('recognizes minified hash function coverage through its original source and fails without segments', async () => {
  const built = await minifiedHash()
  const consumer = new SourceMapConsumer(built.map)
  const position = consumer.generatedPositionFor({
    source: built.map.sources[0],
    line: 10,
    column: 2,
  })
  const offset =
    built.code
      .split('\n')
      .slice(0, position.line - 1)
      .reduce((sum, line) => sum + line.length + 1, 0) + position.column
  const operation = { id: 'sample-reindex', device: '0', at: 100 }
  const rows = [
    { ...operation, event: 'reindex-js-coverage-ready', at: 90 },
    { ...operation, event: 'reindex-js-coverage', file: 'before' },
    { ...operation, event: 'reindex-js-coverage', file: 'after' },
  ]
  const load = async () => ({
    result: [
      {
        url: 'plugin:abele',
        functions: [
          { functionName: 'a', ranges: [{ startOffset: offset, endOffset: offset + 1, count: 2 }] },
        ],
      },
    ],
  })
  const result = await javascriptHashEvidence(operation, rows, load, {
    source: built.code,
    map: built.map,
  })
  expect(result.complete).toBe(true)
  expect(result.calls).toBe(4)
  expect(
    (await javascriptHashEvidence(operation, [], load, { source: built.code, map: built.map }))
      .complete
  ).toBe(false)
})

it('observes actual minified incremental SHA-256 through exact-column V8 breakpoints', async () => {
  const built = await build({
    stdin: {
      contents: 'export { SHA256 } from "@noble/hashes/sha2.js";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    minify: true,
    sourcemap: 'external',
    outfile: 'sample-hash.js',
    write: false,
    format: 'cjs',
  })
  const source = built.outputFiles.find((file) => file.path.endsWith('.js'))!.text
  const map = JSON.parse(built.outputFiles.find((file) => file.path.endsWith('.map'))!.text)
  const points = hashTracepoints(source, map)
  const session = new Session()
  session.connect()
  const post = (name: string, params = {}) =>
    new Promise<any>((resolve, reject) =>
      session.post(name as any, params, (error, result) =>
        error ? reject(error) : resolve(result)
      )
    )
  const rows: any[] = []
  const context: any = {
    module: { exports: {} },
    __scaleObserveIncrementalHash: (hash: unknown) =>
      reindex.observeIncrementalHash(hash, (row: unknown) => rows.push(row)),
  }
  try {
    await post('Debugger.enable')
    await post('Profiler.enable')
    await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
    for (const location of points)
      await post('Debugger.setBreakpointByUrl', {
        url: 'plugin:abele',
        ...location,
        condition: '(()=>{globalThis.__scaleObserveIncrementalHash(this);return false})()',
      })
    runInNewContext(source + '\n//# sourceURL=plugin:abele', context)
    const bytes = new Uint8Array([1, 2, 3])
    const hash = new context.module.exports.SHA256()
    hash.update(bytes.subarray(0, 1)).update(bytes.subarray(1))
    const digest = hash.digest()
    const expected = createHash('sha256').update(bytes).digest('hex')
    expect(Buffer.from(digest).toString('hex')).toBe(expected)
    expect(rows).toEqual([
      expect.objectContaining({ implementation: 'javascript', bytes: 3, sha: expected }),
    ])
    const coverage = await post('Profiler.takePreciseCoverage')
    const operation = { id: 'sample-reindex', device: '0', at: 100 }
    const proof = await javascriptHashEvidence(
      operation,
      [
        { ...operation, event: 'reindex-js-coverage-ready', at: 90 },
        { ...operation, event: 'reindex-js-coverage', file: 'before' },
        { ...operation, event: 'reindex-js-coverage', file: 'after' },
      ],
      async () => coverage,
      { source, map }
    )
    expect(proof.complete).toBe(true)
    expect(proof.calls).toBeGreaterThan(0)
  } finally {
    session.disconnect()
  }
})
