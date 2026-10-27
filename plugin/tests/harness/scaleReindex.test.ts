// @vitest-environment node
import { expect, it } from 'vitest'
import { budgets } from '../scale/oracles.mjs'
import {
  hashTracepointBoundary,
  declaredInterruptions,
  reindexEvidence,
  completedBlobShas,
  previouslyHashedShas,
  payloadUploadEvents,
  classifyReindexHashes,
} from '../scale/reindex.mjs'

it('counts reindex hashes only before completion and reports later install payload digests separately', () => {
  const operation = { id: 'sample', device: '1', at: 100 }
  const rows = [
    {
      event: 'renderer-hash',
      device: '1',
      at: 150,
      source: 'abele',
      sha: 'known',
      stack: 'at scan',
    },
    { event: 'reindex-complete', device: '1', id: 'sample', at: 200 },
    {
      event: 'renderer-hash',
      device: '1',
      at: 210,
      source: 'abele',
      sha: 'known',
      stack: 'at async Object.seal (plugin:abele:1:1)',
    },
    {
      event: 'renderer-hash',
      device: '1',
      at: 220,
      source: 'abele',
      sha: 'known',
      stack: 'at inspect',
    },
    { event: 'renderer-hash', device: '0', at: 160, source: 'abele', sha: 'known' },
  ]
  const result = classifyReindexHashes(operation, rows, 300, new Set(['known']))
  expect(result.reindexHashes).toHaveLength(1)
  expect(result.payloadDigests).toHaveLength(1)
  expect(result.otherPostReindexHashes).toHaveLength(1)
  expect(result.reindexHashes[0].at).toBe(150)
})

it('checks direct small-file PUTs as well as multipart payloads for redundant upload', () => {
  const root = '/v2/uploads/' + 'a'.repeat(64)
  const rows = [
    { event: 'start', method: 'PUT', route: root, sent: 12 },
    { event: 'start', method: 'PUT', route: root + '/sample/0', sent: 12 },
    { event: 'start', method: 'POST', route: root + '/begin', sent: 12 },
    { event: 'start', method: 'PUT', route: root, sent: 0 },
  ]
  expect(payloadUploadEvents(rows)).toEqual(rows.slice(0, 2))
})

it('knows completed blobs before manifest publication but not partial or failed uploads', () => {
  const rows: Array<Record<string, unknown>> = [],
    expected = ['a', 'b', 'c'].map((v) => v.repeat(64))
  const add = (
    id: number,
    method: string,
    sha: string,
    suffix: string,
    status: number | undefined,
    finishedAt = 90
  ) => {
    rows.push({
      event: 'start',
      device: '0',
      id,
      at: 80,
      method,
      route: '/v2/uploads/' + sha.repeat(64) + suffix,
    })
    rows.push({ event: 'finish', device: '0', id, at: finishedAt, status })
  }
  add(1, 'HEAD', 'a', '', 200)
  add(2, 'PUT', 'b', '', 201)
  add(3, 'POST', 'c', '/sample/complete', 200)
  add(4, 'PUT', 'd', '/sample/0', 204)
  add(5, 'PUT', 'e', '', 500)
  add(6, 'PUT', 'f', '', 201, 110)
  add(7, 'HEAD', '1', '', undefined)
  expect([...completedBlobShas(rows, 100)].sort()).toEqual(expected)
})

it('retains known fingerprint hashes across renderer restarts for the reindex oracle', () => {
  const rows = [
    { event: 'renderer-hash', device: '0', at: 20, source: 'abele', sha: 'sample-first' },
    { event: 'renderer-start', device: '0', at: 50 },
    { event: 'renderer-hash', device: '0', at: 80, source: 'abele', sha: 'sample-after-restart' },
    { event: 'renderer-hash', device: '0', at: 85, source: 'host', sha: 'sample-host' },
    { event: 'renderer-hash', device: '1', at: 90, source: 'abele', sha: 'sample-peer' },
    { event: 'renderer-hash', device: '0', at: 110, source: 'abele', sha: 'sample-later' },
  ]
  expect([...previouslyHashedShas(rows, '0', 100)]).toEqual([
    'sample-first',
    'sample-after-restart',
  ])
})

it('requires every declared occurrence, rather than a count of distinct kinds', () => {
  const declared = declaredInterruptions(true)
  const triggered = declared.slice(0, -1).map((one) => ({ ...one, triggered: true }))
  triggered.push({ ...declared[6], triggered: true })
  const gate = budgets({ declaredInterruptions: declared, interruptions: triggered }).find(
    (one) => one.name === 'interruptions'
  )
  expect(gate?.status).toBe('FAIL')
  expect(
    budgets({
      declaredInterruptions: declared,
      interruptions: declared.map((one) => ({ ...one, triggered: true })),
    }).find((one) => one.name === 'interruptions')?.status
  ).toBe('PASS')
})

it('keeps indexing traffic and writes visible and fails missing or changed evidence', () => {
  const operation = { id: 'reindex-primary-upload', kind: 'reindex', device: '0', at: 100 }
  const rows = [
    { event: 'reindex-complete', id: operation.id, device: '0', at: 200 },
    { event: 'vault-delete', device: '0', at: 140, path: 'Notes/sample.md' },
    { event: 'renderer-hash', device: '0', at: 150, source: 'abele', bytes: 12 },
  ]
  const result = reindexEvidence(
    operation,
    rows,
    [{ event: 'start', device: '0', at: 120, route: '/v2/manifest' }],
    {
      before: [{ path: 'Notes/sample.md', sha: 'a', size: 12 }],
      after: [],
      settled: true,
    }
  )
  expect(result.durationMs).toBe(100)
  expect(result.requests).toHaveLength(1)
  expect(result.deletions).toHaveLength(1)
  expect(result.rendererHashes).toHaveLength(1)
  expect(result.status).toBe('FAIL')
  expect(reindexEvidence(operation, [], [], {}).status).toBe('FAIL')
})

it('clicks the real setting once, persists actual click time, and observes host completion after reload', async () => {
  const { readFile } = await import('node:fs/promises')
  const { runInNewContext } = await import('node:vm')
  const source = await readFile(new URL('../scale/reindex.cjs', import.meta.url), 'utf8')
  const files = new Map(),
    rows = [],
    scheduled = [],
    calls = []
  const module = { exports: {} }
  const fs = {
    writeFileSync: (path, value) => files.set(path, value),
    appendFileSync: () => {
      throw new Error('Click evidence must use the ordered host sink')
    },
    existsSync: (path) => files.has(path),
    readFileSync: (path) => files.get(path),
    unlinkSync: (path) => files.delete(path),
  }
  runInNewContext(source, {
    module,
    exports: module.exports,
    __scaleEmitEvidence: (value) => rows.push(value),
    require: (name) => (name === 'node:fs' ? fs : { resolve: (p) => p }),
    setTimeout: (fn) => scheduled.push(fn),
    Date,
    Buffer,
  })
  const api = module.exports as any
  let completed,
    opened = false
  const app = {
    setting: {
      open: async () => {
        calls.push('open')
        await Promise.resolve()
        opened = true
      },
      openTabById: (id) => {
        expect(opened).toBe(true)
        calls.push(id)
      },
    },
    workspace: { onLayoutReady: (fn) => fn() },
    metadataCache: {
      onCleanCache: (fn) => {
        completed = fn
      },
      clear: () => {
        throw Error('internal action forbidden')
      },
    },
    vault: { on: () => 'ref', offref: () => {} },
  }
  const button = { click: () => calls.push('click') }
  const row = {
    querySelector: () => ({ textContent: 'Rebuild vault cache' }),
    querySelectorAll: () => [button],
  }
  await api.clickRebuild(
    app,
    { querySelectorAll: () => [row] },
    { id: 'sample', device: '0' },
    'trace.0.reindex.json'
  )
  expect(calls).toEqual(['open', 'file'])
  scheduled[0]()
  expect(calls).toEqual(['open', 'file', 'click'])
  expect(rows[0]).toMatchObject({
    event: 'reindex-click',
    id: 'sample',
    device: '0',
    at: expect.any(Number),
  })
  api.observeRebuild(
    app,
    { evidence: 'trace', device: '0' },
    (row) => rows.push(row),
    () => {}
  )
  expect(rows.some((row) => row.event === 'reindex-complete')).toBe(false)
  await completed()
  expect(rows.at(-1)).toMatchObject({
    event: 'reindex-complete',
    id: 'sample',
    at: expect.any(Number),
  })
  expect(files.has('trace.0.reindex.json')).toBe(false)
  expect(JSON.parse(files.get('trace.0.reindex.json.complete.json'))).toMatchObject({
    id: 'sample',
    completedAt: expect.any(Number),
  })
  await expect(
    api.clickRebuild(app, { querySelectorAll: () => [row, row] }, {}, 'trace')
  ).rejects.toThrow('ambiguous')
})

it('passes only complete unchanged evidence and retains allowed peer additions', () => {
  const operation = { id: 'reindex-peer-download', device: '1', at: 100 }
  const before = [{ path: 'Notes/sample.md', sha: 'a', size: 1 }]
  const rows = [{ event: 'reindex-complete', id: operation.id, device: '1', at: 200 }]
  const proof = {
    before,
    after: [...before, { path: 'Notes/new.md', sha: 'b', size: 2 }],
    settled: true,
    extraUploads: 0,
    extraDownloads: 0,
    extraRendererHashes: 0,
  }
  expect(reindexEvidence(operation, rows, [], proof).status).toBe('PASS')
  for (const key of ['extraUploads', 'extraDownloads', 'extraRendererHashes']) {
    expect(reindexEvidence(operation, rows, [], { ...proof, [key]: undefined }).status).toBe('FAIL')
    expect(reindexEvidence(operation, rows, [], { ...proof, [key]: 1 }).status).toBe('FAIL')
  }
  expect(
    reindexEvidence(
      operation,
      rows,
      [{ device: '1', at: 120, operations: [{ op: 'delete', path: 'Notes/sample.md' }] }],
      proof
    ).status
  ).toBe('FAIL')
})

it('observes native hashes without changing their bytes, return values or restoration', async () => {
  const { default: observer } = await import('../scale/reindex.cjs')
  const { createHash } = await import('node:crypto')
  const crypto = { createHash },
    rows = []
  const digest = async (_algorithm, data) => Buffer.from(data)
  const subtle = { digest }
  const restore = observer.observeHashes(crypto, subtle, (row) => rows.push(row))
  expect(crypto.createHash('sha256').update('sample').digest('hex')).toBe(
    createHash('sha256').update('sample').digest('hex')
  )
  expect(Buffer.from(await subtle.digest('sample', Buffer.from('data'))).toString()).toBe('data')
  expect(rows[0].event).toBe('hash-observer-ready')
  expect(rows[1]).toMatchObject({
    event: 'renderer-hash',
    bytes: 6,
    sha: expect.stringMatching(/^[a-f0-9]{64}$/),
  })
  expect(rows[2]).toMatchObject({ event: 'renderer-hash', bytes: 4, sha: '64617461' })
  restore()
  expect(crypto.createHash).toBe(createHash)
  expect(subtle.digest).toBe(digest)
})

it('never infers zero JavaScript hashing from native counters or missing reload coverage', async () => {
  const { javascriptHashEvidence } = await import('../scale/reindex.mjs')
  const operation = { id: 'sample', device: '0', at: 100 }
  const rows = [
    { id: 'sample', device: '0', at: 99, event: 'reindex-js-coverage-ready' },
    { id: 'sample', device: '0', at: 101, event: 'reindex-js-coverage', file: 'before' },
    { id: 'sample', device: '0', at: 200, event: 'reindex-js-coverage', file: 'after' },
  ]
  const load = async () => ({
    result: [
      {
        url: 'plugin:abele',
        functions: [{ functionName: 'SHA256', ranges: [{ count: 0, startOffset: 10 }] }],
      },
    ],
  })
  expect(await javascriptHashEvidence(operation, rows, load)).toMatchObject({
    complete: true,
    calls: 0,
  })
  expect(await javascriptHashEvidence(operation, rows.slice(0, 2), load)).toMatchObject({
    complete: false,
    calls: null,
  })
  expect(await javascriptHashEvidence(operation, rows, async () => ({ result: [] }))).toMatchObject(
    { complete: false, calls: null }
  )
  expect(
    await javascriptHashEvidence(operation, rows, async () => ({
      result: [
        { url: 'plugin:abele', functions: [{ functionName: 'SHA256', ranges: [{ count: 2 }] }] },
      ],
    }))
  ).toMatchObject({ complete: true, calls: 4 })
})

it('observes incremental JavaScript digests without hashing again or changing results', async () => {
  const { default: observer } = await import('../scale/reindex.cjs')
  const rows = []
  let calls = 0
  const hash = {
    length: 0,
    update(bytes) {
      this.length += bytes.byteLength
      return this
    },
    digestInto(out) {
      calls++
      out.set([1, 2])
      return out
    },
    digest() {
      return this.digestInto(new Uint8Array(2))
    },
  }
  observer.observeIncrementalHash(hash, (row) => rows.push(row))
  observer.observeIncrementalHash(hash, (row) => rows.push(row))
  expect(hash.update(new Uint8Array(12))).toBe(hash)
  expect([...hash.digest()]).toEqual([1, 2])
  expect(calls).toBe(1)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ implementation: 'javascript', bytes: 12, sha: '0102' })
})

it('proves digest coverage from both renderer generations despite delayed main-process acknowledgements', async () => {
  const { digestCoverage } = await import('../scale/reindex.mjs')
  const operation = { id: 'sample', device: '0', at: 100 }
  const rows = [
    { device: '0', event: 'renderer-start', at: 1 },
    { device: '0', event: 'javascript-hash-observer-ready', at: 10 },
    { device: '0', implementation: 'javascript', at: 20 },
    { device: '0', event: 'reindex-reloaded', id: 'sample', at: 110 },
    { device: '0', implementation: 'javascript', at: 120 },
    { device: '0', event: 'javascript-hash-observer-ready', at: 130 },
  ]
  expect(digestCoverage(operation, rows, 200).complete).toBe(true)
  expect(
    digestCoverage(
      operation,
      rows.filter((row) => row.at !== 120),
      200
    ).complete
  ).toBe(false)
  expect(
    digestCoverage(
      operation,
      rows.filter((row) => row.at !== 130),
      200
    ).complete
  ).toBe(false)
})

it('separates host cache hashes by their actual stack, including intrinsic Promise frames', async () => {
  const { default: observer } = await import('../scale/reindex.cjs')
  const { default: diagnostics } = await import('../scale/diagnostics.cjs')
  const prefix = 'Error\n at observe (/fixture/scale-observer/reindex.cjs:1:1)\n'
  expect(
    observer.classifyHashOrigin(
      prefix + ' at index (app://obsidian.md/app.js:1:1)\n at new Promise (<anonymous>)',
      diagnostics.classifyOrigin
    )
  ).toBe('host')
  expect(
    observer.classifyHashOrigin(prefix + ' at index (plugin:abele:1:1)', diagnostics.classifyOrigin)
  ).toBe('abele')
  expect(
    observer.classifyHashOrigin(
      prefix + ' at index (https://example.invalid/app.js:1:1)',
      diagnostics.classifyOrigin
    )
  ).toBe('unknown')
})

it('places the hash instrumentation gate after the evaluation mark, refusing missing marks', () => {
  expect(hashTracepointBoundary('setup();\nmarkLoad("evalEnd");\nstart();')).toBe(2)
  expect(() => hashTracepointBoundary('setup();')).toThrow('evaluation boundary')
})
