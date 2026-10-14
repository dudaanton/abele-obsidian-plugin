import { describe, expect, it } from 'vitest'
import { decorate, lengthWords, recording, run, runSummary, trail } from '@/debugger/trace/mapping'
import { nodeTraceSupported, WireRunSchema } from '@/debugger/trace/wire'

const wireRun = WireRunSchema.parse({
  run: {
    id: 'run-1',
    name: 'Sample run',
    debug_session_id: 'debug-1',
    started_at: '2026-01-02T03:04:05.000Z',
    length_ms: 83_000,
    state: 'cut',
    steps: 2,
    bytes: 4096,
    extra: 'a newer node may add fields',
  },
  points: [
    {
      breakpoint_id: 'bp-1',
      file: 'src/sample.ts',
      line: 4,
      take: ['sample'],
      hits: 2,
      last: 'sample { items: 2 }',
    },
  ],
  steps: [
    {
      id: 't0001',
      kind: 'probe',
      ts: '2026-01-02T03:04:05.100Z',
      at: 100,
      label: 'Sample read',
      point: 'bp-1',
      place: { file: 'src/sample.ts', line: 4, fn: 'readSample' },
      paused_ms: 12.6,
      values: [{ name: 'sample', format: 'json', bytes: 2048, brief: '{ items: 2 }' }],
    },
    {
      id: 't0002',
      kind: 'probe',
      ts: '2026-01-02T03:04:05.300Z',
      at: 300,
      label: 'Sample read',
      marked: true,
      values: [
        { name: 'sample', format: 'json', bytes: 2048, brief: '{ items: 2 }', same: true },
        { name: 'other', format: 'text', bytes: 0, brief: '', failed: 'other is not defined' },
      ],
    },
  ],
  marks: [],
  folder: '/sample/runs',
})

describe('a run as the views draw it', () => {
  it('keeps the steps, their places and values, and says a run was cut short', () => {
    const r = run(wireRun)
    expect(r).toMatchObject({ id: 'run-1', name: 'Sample run', length: '1:23', cut: true })
    expect(r.steps[0]).toEqual({
      id: 't0001',
      kind: 'probe',
      at: 100,
      label: 'Sample read',
      place: { file: 'src/sample.ts', line: 4, fn: 'readSample' },
      pausedMs: 13,
      values: [{ name: 'sample', brief: '{ items: 2 }', bytes: 2048, format: 'json' }],
    })
    expect(r.steps[1]!.marked).toBe(true)
    expect(r.steps[1]!.values).toEqual([
      { name: 'sample', brief: '{ items: 2 }', bytes: 2048, format: 'json', same: true },
      { name: 'other', brief: '', bytes: 0, format: 'text', failed: 'other is not defined' },
    ])
  })

  it('says how long a run went, and how long one still being recorded has gone', () => {
    expect(lengthWords(400)).toBe('0.4 s')
    expect(lengthWords(42_000)).toBe('42 s')
    expect(lengthWords(102_000)).toBe('1:42')
    const now = Date.parse('2026-01-02T03:05:00.000Z')
    expect(runSummary({ ...wireRun.run, length_ms: undefined, state: 'recording' }, now)).toEqual({
      id: 'run-1',
      name: 'Sample run',
      steps: 2,
      length: '55 s',
    })
    expect(
      recording(
        {
          folder: '/sample/runs',
          chosen: false,
          recording: { run_id: 'run-1', steps: 7, started_at: '2026-01-02T03:04:05.000Z' },
        },
        now
      )
    ).toEqual({
      elapsed: '0:55',
      steps: 7,
      browser: { state: 'none', via: 'chrome', hosts: [] },
      folder: '/sample/runs',
    })
    expect(recording({ folder: '/x', chosen: false, recording: null })).toBeUndefined()
  })

  it('turns a trail into the stops the view lists', () => {
    expect(
      trail({
        value: 'C-1',
        stops: [{ step: 't0001', name: 'sample', path: '$.id', change: 'moved' }],
        lost_after: 't0001',
      })
    ).toEqual({
      value: 'C-1',
      stops: [{ step: 't0001', path: '$.id', change: 'moved' }],
      lostAfter: 't0001',
    })
  })
})

describe('record points among the breakpoints', () => {
  it('marks a record point with what it takes and how it did in the newest run', () => {
    const marked = decorate(
      [
        { id: 'bp-1', file: 'src/sample.ts', line: 4, state: 'set', condition: 'sample.ok' },
        { id: 'bp-2', file: 'src/sample.ts', line: 9, state: 'pending' },
      ],
      [{ breakpoint_id: 'bp-1', take: ['sample'], note: 'Sample read' }],
      wireRun.points
    )
    expect(marked).toEqual([
      {
        file: 'src/sample.ts',
        line: 4,
        state: 'set',
        kind: 'record',
        take: ['sample'],
        when: 'sample.ok',
        note: 'Sample read',
        hits: 2,
        last: 'sample { items: 2 }',
      },
      { file: 'src/sample.ts', line: 9, state: 'pending' },
    ])
  })
})

describe('whether a node records runs', () => {
  it('reads the capability the node advertises', () => {
    const describe = (trace?: object) => ({
      capabilities: { capabilities: { ...(trace ? { trace_v1: trace } : {}) } },
    })
    expect(nodeTraceSupported(describe({ status: 'supported', evidence: 'x' }))).toBe(true)
    expect(nodeTraceSupported(describe())).toBe(false)
    expect(nodeTraceSupported(undefined)).toBe(false)
  })
})
