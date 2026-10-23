// @vitest-environment node
import { expect, it } from 'vitest'
import { budgets } from '../scale/oracles.mjs'
import { declaredInterruptions, reindexEvidence } from '../scale/reindex.mjs'

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
    appendFileSync: (_path, value) => rows.push(JSON.parse(value)),
    existsSync: (path) => files.has(path),
    readFileSync: (path) => files.get(path),
    unlinkSync: (path) => files.delete(path),
  }
  runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) => (name === 'node:fs' ? fs : { resolve: (p) => p }),
    setTimeout: (fn) => scheduled.push(fn),
    Date,
    Buffer,
  })
  const api = module.exports as any
  let completed
  const app = {
    setting: { open: () => calls.push('open'), openTabById: (id) => calls.push(id) },
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
