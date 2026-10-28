// Project authorization has its own tests; these cases exercise request/trace behavior.
vi.mock('@/ai/tools/node/projectAccess', () => ({ nodeProjectGuard: async () => () => {} }))
import { describe, expect, it, vi } from 'vitest'
import {
  createTraceTools,
  TRACE_AGENT_BYTES,
  TRACE_AGENT_LINES,
  type TraceToolContext,
} from '@/ai/tools/TraceTools'
import { TraceRpc } from '@/debugger/trace/wire'
import { createAgentTools } from '@/ai/tools'
import { DEFAULT_AI_SETTINGS, TRACE_TOOL_MODES } from '@/ai/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

const summary = {
  id: 'run-new',
  name: 'Sample run',
  debug_session_id: 'debug-1',
  started_at: '2026-01-02T03:04:05.000Z',
  state: 'done',
  steps: 300,
  bytes: 1,
}
const step = (i: number) => ({
  id: `t${String(i + 1).padStart(4, '0')}`,
  kind: 'probe',
  ts: 'x',
  at: i * 10,
  label: 'Sample read',
  place: { file: 'src/sample.ts', line: 4 },
  values: [
    {
      name: 'sample',
      format: 'json',
      bytes: 40,
      brief: '{ items: 2 }',
      ...(i % 2 ? { same: true } : {}),
    },
  ],
})

function setup() {
  const request = vi.fn(async (method: string, params: any): Promise<unknown> => {
    switch (method) {
      case 'trace.v1.runs':
        return { folder: '/runs', chosen: false, runs: [summary, { ...summary, id: 'run-old' }] }
      case 'trace.v1.run': {
        const from = params.from ?? 0
        return {
          run: summary,
          points: [],
          steps: Array.from({ length: Math.min(params.limit ?? 300, 300 - from) }, (_, i) =>
            step(from + i)
          ),
          next: from + (params.limit ?? 300) < 300 ? from + (params.limit ?? 300) : undefined,
          marks: [],
          folder: '/runs',
        }
      }
      case 'trace.v1.value':
        if (params.view === 'slice')
          return {
            value: step(0).values[0],
            page: { lines: ['"x".repeat'], next: 80, truncated: true, total: 500 },
          }
        if (params.view === 'shape')
          return {
            value: step(0).values[0],
            shape: { type: 'object', children: [{ key: 'items', type: 'array', count: 2 }] },
          }
        return {
          value: step(0).values[0],
          changes: {
            against: { step: 't0001', name: 'sample' },
            summary: '50% the same · 1 changed type',
            changes: [
              {
                path: '$.items[*].amount',
                kind: 'type',
                before: 'string',
                after: 'number',
                count: 2,
              },
            ],
          },
        }
      case 'trace.v1.find':
        return {
          hits: Array.from({ length: 200 }, (_, i) => ({
            step: 't0001',
            name: 'sample',
            path: `$.items[${i}]`,
          })),
        }
      case 'trace.v1.follow':
        return {
          value: 'C-1',
          stops: [{ step: 't0001', name: 'sample', path: '$.id' }],
          lost_after: 't0001',
        }
      case 'trace.v1.mark':
        return { mark: params }
    }
    throw new Error(method)
  })
  const rpc = new TraceRpc(request)
  const context: TraceToolContext = {
    rpc,
    projectId: 'project-1',
    registrationId: 'node-1',
    runs: async () => (await rpc.runs('project-1')).runs,
    addPoint: vi.fn(async () => {}),
    writeNote: vi.fn(async () => 'Trace/Sample run.md'),
  }
  const tools = Object.fromEntries(createTraceTools(() => context).map((t) => [t.name, t]))
  const call = async (name: string, params: Record<string, unknown> = {}) =>
    (await tools[name]!.execute('call', params)).content[0]!.text
  return { request, context, tools, call }
}

describe('the agent reading a recorded run', () => {
  it('has a tool for each view and none that shows a run or a value whole', () => {
    expect(Object.keys(setup().tools).sort()).toEqual([
      'trace_diff',
      'trace_find',
      'trace_follow',
      'trace_mark',
      'trace_note',
      'trace_point_add',
      'trace_runs',
      'trace_shape',
      'trace_slice',
      'trace_timeline',
    ])
  })

  it('reads the newest run unless told which, and stops at its ceiling with where to go on', async () => {
    const s = setup()
    const timeline = await s.call('trace_timeline')
    expect(s.request).toHaveBeenCalledWith('trace.v1.run', {
      project_id: 'project-1',
      run_id: 'run-new',
      limit: TRACE_AGENT_LINES,
    })
    const lines = timeline.split('\n')
    expect(lines.length).toBeLessThanOrEqual(TRACE_AGENT_LINES + 2)
    expect(Buffer.byteLength(timeline)).toBeLessThan(TRACE_AGENT_BYTES + 200)
    expect(lines[1]).toBe(
      't0001 · +0.00s · probe · "Sample read" · src/sample.ts:4 · sample={ items: 2 } [40 B]'
    )
    expect(lines[2]).toContain('sample=same')
    expect(timeline).toMatch(/call again with from: \d+/)
    await s.call('trace_timeline', { run: 'run-old', from: 80 })
    expect(s.request).toHaveBeenLastCalledWith('trace.v1.run', {
      project_id: 'project-1',
      run_id: 'run-old',
      from: 80,
      limit: TRACE_AGENT_LINES,
    })
  })

  it('asks the node for its agent ceiling on every value view', async () => {
    const s = setup()
    expect(await s.call('trace_shape', { step: 't0001', name: 'sample' })).toContain(
      'items: array (2)'
    )
    const slice = await s.call('trace_slice', {
      step: 't0001',
      name: 'sample',
      path: '$.items',
      from: 0,
    })
    expect(slice).toContain('call again with from: 80 (of 500 lines)')
    expect(await s.call('trace_diff', { step: 't0002', name: 'sample' })).toContain(
      'type $.items[*].amount: string → number in 2 places'
    )
    for (const [, p] of s.request.mock.calls.filter(([m]) => m === 'trace.v1.value'))
      expect((p as { cap: string }).cap).toBe('agent')
  })

  it('finds, follows, and keeps a long list of hits under the ceiling', async () => {
    const s = setup()
    const found = await s.call('trace_find', { value: 'C-1' })
    expect(found.split('\n').length).toBeLessThanOrEqual(TRACE_AGENT_LINES + 1)
    expect(await s.call('trace_follow', { value: 'C-1' })).toBe(
      't0001 · sample · $.id\nnot seen after t0001'
    )
    await expect(s.call('trace_find', {})).rejects.toThrow(/value or a key/)
  })

  it('marks, sets a record point and writes a note through the session', async () => {
    const s = setup()
    await s.call('trace_mark', {
      step: 't0002',
      name: 'sample',
      path: '$.items',
      comment: 'look',
      tags: ['question', 3],
    })
    expect(s.request).toHaveBeenLastCalledWith('trace.v1.mark', {
      project_id: 'project-1',
      run_id: 'run-new',
      step: 't0002',
      name: 'sample',
      path: '$.items',
      comment: 'look',
      tags: ['question'],
    })
    await s.call('trace_point_add', {
      file: 'src/sample.ts',
      line: 4,
      take: ['sample'],
      note: 'Sample read',
    })
    expect(s.context.addPoint).toHaveBeenCalledWith(
      'src/sample.ts',
      4,
      {
        take: ['sample'],
        note: 'Sample read',
      },
      expect.any(Function)
    )
    expect(await s.call('trace_point_add', { file: 'src/sample.ts', line: 5, take: [] })).toBe(
      'Record point set at src/sample.ts:5, taking nothing: name what to take for it to record values.'
    )
    await expect(
      s.call('trace_point_add', { file: 'src/sample.ts', line: 0, take: [] })
    ).rejects.toThrow(/line/)
    expect(await s.call('trace_note')).toBe('Note written: Trace/Sample run.md')
    s.context.writeNote = vi.fn(async () => '/srv/sample-notes/Sample run.md')
    expect(await s.call('trace_note')).toMatch(
      /^Note written outside the vault: \/srv\/sample-notes\/Sample run\.md\. Vault file tools cannot reach it/
    )
    expect(s.context.writeNote).toHaveBeenCalledWith('run-new')
  })

  it('says plainly when no session records runs', async () => {
    const [runs] = createTraceTools(() => undefined)
    await expect(runs!.execute('call', {})).rejects.toThrow(
      /No debugger session that records runs is open/
    )
  })

  it('follows the usual modes: reading a run on its own, a mark, a point or a note asks', () => {
    expect(TRACE_TOOL_MODES).toEqual({
      trace_runs: 'auto',
      trace_timeline: 'auto',
      trace_shape: 'auto',
      trace_slice: 'auto',
      trace_diff: 'auto',
      trace_find: 'auto',
      trace_follow: 'auto',
      trace_mark: 'ask',
      trace_point_add: 'ask',
      trace_note: 'ask',
      // The saved requests' tools stand in the same section.
      http_requests: 'auto',
      http_request_read: 'auto',
      http_send_result: 'auto',
      http_request_save: 'ask',
      http_send: 'ask',
      http_import: 'ask',
    })
  })

  it('is handed to every agent like any other tool, its mode decides the rest', () => {
    useVault([])
    AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
    const names = createAgentTools().map((t) => t.name)
    for (const name of Object.keys(TRACE_TOOL_MODES)) expect(names).toContain(name)
  })
})
