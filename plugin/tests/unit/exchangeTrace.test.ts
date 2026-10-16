import { expect, it, vi } from 'vitest'
import { ExchangeTrace } from '@/sync/exchangeTrace'
import { assertPullEvidence } from '../helpers/smallPullBounds'
import * as pullCounters from '@/sync/pullOperationCounts'

it('reuses its counter pool for every file instead of allocating per-file counter objects', async () => {
  const factory = vi.spyOn(pullCounters, 'emptyPullCounts')
  try {
    const trace = new ExchangeTrace()
    const allocated = factory.mock.calls.length
    expect(allocated).toBeGreaterThan(0)
    for (let i = 0; i < 1000; i++)
      await trace.pull(100, async () => {
        trace.record('adapter stat', Date.now(), 'complete')
        return true
      })
    expect(factory).toHaveBeenCalledTimes(allocated)
  } finally {
    factory.mockRestore()
  }
})

it('performs no console bridge calls while recording a complete file pull', async () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
  try {
    const trace = new ExchangeTrace()
    await trace.pull(100, async () => {
      trace.record('GET /v2/files/sample/content', Date.now(), 'complete')
      await trace.run('preserve local edit copies', async () => {})
      await trace.run(
        'placement Notes/sample.md',
        async () => {
          trace.record('adapter writeBinary', Date.now(), 'complete')
          trace.record('adapter rename', Date.now(), 'complete')
          trace.record('journal save', Date.now(), 'complete')
          trace.record('journal save', Date.now(), 'complete')
        },
        true
      )
      return true
    })
    trace.finishFirstSync()
    expect(debug).not.toHaveBeenCalled()
    expect(trace.snapshot().firstSync.pulls.small.max).toMatchObject({
      writes: 1,
      publications: 1,
      journal: 2,
    })
  } finally {
    debug.mockRestore()
  }
})

it.each([
  '.obsidian/plugins/abele/sync-staging',
  '.abele-sync/connections/sample/writes',
  '/vault/.abele-sync/connections/sample/writes',
])('counts a real write to %s before publication', async (directory) => {
  const trace = new ExchangeTrace()
  await trace.pull(
    100,
    async () => {
      trace.record('adapter writeBinary', Date.now(), 'complete', [
        directory + '/.abele-sync-abcdefgh.tmp',
      ])
      trace.record('adapter rename', Date.now(), 'complete', [
        directory + '/.abele-sync-abcdefgh.tmp',
        'Notes/sample.md',
      ])
      return true
    },
    'Notes/sample.md'
  )
  expect(trace.snapshot().firstSync.pulls.small.max).toMatchObject({
    writes: 1,
    publications: 1,
    bridge: 2,
  })
})

it('attributes concurrent other-file reads separately from a pull and its preparation', async () => {
  const trace = new ExchangeTrace()
  await trace.pull(
    100,
    async () => {
      const prepared = trace.begin('preserve local edit copies')
      trace.record('adapter stat', Date.now(), 'complete', ['Notes/sample.md'])
      prepared()
      for (let i = 0; i < 300; i++) {
        trace.record('adapter stat', Date.now(), 'complete', ['Other/file.md'])
        trace.record('native read', Date.now(), 'complete', ['/vault/Other/file.md'])
      }
      trace.record('adapter writeBinary', Date.now(), 'complete', [
        'Notes/.abele-sync-abcdefgh.tmp',
      ])
      return true
    },
    'Notes/sample.md'
  )
  const counts = trace.snapshot().firstSync.pulls.small.max
  expect(counts).toMatchObject({ bridge: 1, native: 0, writes: 1, preparationBridge: 1 })
})

it('keeps complete bounded pull evidence after diagnostic rings overflow', async () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
  try {
    const trace = new ExchangeTrace()
    for (let i = 0; i < 5000; i++) {
      await trace.pull(8203, async () => {
        trace.record(`GET /v2/files/sample-${i}/content`, Date.now(), 'complete')
        const finish = trace.begin(`placement Notes/sample-${i}.md`)
        for (const op of ['adapter writeBinary', 'adapter rename', 'journal save', 'journal save'])
          trace.record(op, Date.now(), 'complete')
        finish()
        return true
      })
    }
    trace.finishFirstSync()
    const evidence = trace.snapshot().firstSync.pulls
    expect(evidence.small.count).toBe(5000)
    expect(evidence.small.sum).toMatchObject({
      requests: 5000,
      writes: 5000,
      publications: 5000,
      journal: 10000,
    })
    expect(evidence.small.min.requests).toBe(1)
    expect(evidence.small.max.requests).toBe(1)
    expect(evidence.contentRequests).toBe(5000)
    expect(evidence.failed).toBe(0)
    expect(evidence.overlap).toBe(false)
    expect(() =>
      assertPullEvidence(evidence, { small: 5000, large: 0, requests: 5000 })
    ).not.toThrow()
    expect(trace.snapshot().firstSync.operations.truncated).toBe(true)
    expect(JSON.stringify(evidence).length).toBeLessThan(2000)
  } finally {
    debug.mockRestore()
  }
})

it('batches console bridge calls while retaining every local diagnostic event', () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
  try {
    const trace = new ExchangeTrace()
    for (let i = 0; i < 1024; i++) trace.record('native read', Date.now(), 'complete')
    trace.finishFirstSync()
    expect(debug).not.toHaveBeenCalled()
    const snapshot = trace.snapshot()
    expect(debug.mock.calls.length).toBeLessThanOrEqual(16)
    const events = debug.mock.calls.flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    expect(events.reduce((total, event) => total + (event.count ?? 1), 0)).toBe(1024)
    expect(events.every((event) => event.operation === 'native read')).toBe(true)
    expect(snapshot.requests).toHaveLength(64)
  } finally {
    debug.mockRestore()
  }
})

it('retains exact first-sync aggregate counts beyond the event ring without file maps', async () => {
  const trace = new ExchangeTrace()
  for (let i = 0; i < 100; i++) {
    await trace.pull(100, async () => {
      trace.record('GET /v2/files/sample-' + i + '/content', Date.now(), 'complete')
      const done = trace.begin('placement Notes/sample-' + i + '.md')
      trace.record('adapter writeBinary', Date.now(), 'complete')
      trace.record('journal save', Date.now(), 'complete')
      done()
      return true
    })
  }
  trace.finishFirstSync()
  trace.record('GET /v2/files/later/content', Date.now(), 'complete')
  const first = trace.snapshot().firstSync
  expect(first.pulls.small.count).toBe(100)
  expect(first.pulls.small.sum).toMatchObject({ requests: 100, writes: 100, journal: 100 })
  expect(first.pulls.contentRequests).toBe(100)
  expect(first.operations.placements).toEqual([])
  expect(first.operations.contentRequests).toEqual({})
})

it('retains bounded local-stage timing events alongside requests', () => {
  const trace = new ExchangeTrace()
  for (let i = 0; i < 80; i++) trace.record('adapter stat', Date.now() - 10, 'complete')
  const requests = trace.snapshot().requests
  expect(requests).toHaveLength(64)
  expect(requests.at(-1)).toMatchObject({ operation: 'adapter stat', outcome: 'complete' })
  expect(requests.at(-1)!.durationMs).toBeGreaterThanOrEqual(10)
})

it('names a stalled operation synchronously and removes it after success or failure', async () => {
  const trace = new ExchangeTrace()
  let release!: () => void
  const job = trace.run(
    'GET /v2/manifest',
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  expect(trace.snapshot().active).toMatchObject([{ operation: 'GET /v2/manifest' }])
  release()
  await job
  expect(trace.snapshot().active).toEqual([])
  await expect(
    trace.run('read file', async () => {
      throw new Error('io')
    })
  ).rejects.toThrow('io')
  expect(trace.snapshot().active).toEqual([])
})
