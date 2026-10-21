import { describe, expect, it, vi } from 'vitest'
import { TraceRunModel } from '@/debugger/trace/TraceRunModel'
import { TraceRpc } from '@/debugger/trace/wire'

it('clears previously loaded evidence when the run is removed', async () => {
  const n = node()
  const model = new TraceRunModel(n.rpc, 'project-1', 'run-1', () => {})
  await model.load()
  await model.pick('t0001')
  await model.follow('"C-1"')
  vi.spyOn(n.rpc, 'wholeRun').mockRejectedValue(new Error('trace_run_not_found'))
  await model.load()
  expect(model.run).toBeUndefined()
  expect(model.wire).toBeUndefined()
  expect(model.picked).toBeUndefined()
  expect(model.trail).toBeUndefined()
  expect(model.error).toBe('This run is no longer on the node.')
  model.dispose()
})

it('follows recording until it ends and releases its timer', async () => {
  vi.useFakeTimers()
  try {
    const n = node()
    const data = await n.rpc.wholeRun('project-1', 'run-1')
    const whole = vi
      .spyOn(n.rpc, 'wholeRun')
      .mockResolvedValueOnce({ ...data, run: { ...data.run, state: 'recording' } })
      .mockResolvedValue(data)
    const m = new TraceRunModel(n.rpc, 'project-1', 'run-1', () => {})
    await m.load()
    await vi.advanceTimersByTimeAsync(2000)
    expect(whole).toHaveBeenCalledTimes(2)
    m.dispose()
    await vi.advanceTimersByTimeAsync(4000)
    expect(whole).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})

it('explains a recording that is no longer on the node', async () => {
  const rpc = new TraceRpc(async () => {
    throw new Error('trace_run_not_found')
  })
  const model = new TraceRunModel(rpc, 'project-1', 'run-1', () => {})
  await model.load()
  expect(model.error).toBe('This run is no longer on the node.')
})

const summary = {
  id: 'run-1',
  name: 'Sample run',
  debug_session_id: 'debug-1',
  started_at: '2026-01-02T03:04:05.000Z',
  length_ms: 900,
  state: 'done',
  steps: 2,
  bytes: 10,
}
const value = (name: string, extra = {}) => ({
  name,
  format: 'json',
  bytes: 40,
  brief: '{ id, items: 2 }',
  ...extra,
})

function node() {
  const request = vi.fn(async (method: string, params: any): Promise<unknown> => {
    if (method === 'trace.v1.run')
      return params.from
        ? {
            run: summary,
            points: [],
            steps: [
              {
                id: 't0002',
                kind: 'probe',
                ts: 'x',
                at: 30,
                label: 'Later',
                values: [value('sample', { same: true })],
              },
            ],
            marks: [],
            folder: '/runs',
          }
        : {
            run: summary,
            points: [],
            steps: [
              {
                id: 't0001',
                kind: 'probe',
                ts: 'x',
                at: 10,
                label: 'First',
                values: [value('sample'), value('gone', { failed: 'not defined' })],
              },
            ],
            next: 1,
            marks: [],
            folder: '/runs',
          }
    if (method === 'trace.v1.value' && params.view === 'shape')
      return {
        value: value(params.name),
        shape: { type: 'object', children: [{ key: 'id', type: 'string', example: '"C-1"' }] },
      }
    if (method === 'trace.v1.value' && params.view === 'changes')
      return {
        value: value(params.name),
        changes: {
          against: { step: 't0000', name: params.name },
          summary: '90% the same · 1 added',
          changes: [],
        },
      }
    if (method === 'trace.v1.follow')
      return {
        value: String(params.value),
        stops: [{ step: 't0001', name: 'sample', path: '$.id' }],
      }
    if (method === 'trace.v1.mark') return { mark: params }
    throw new Error(method)
  })
  return { request, rpc: new TraceRpc(request) }
}

describe('a run open in its tab', () => {
  it('searches whole recorded values on the node and ignores late search results', async () => {
    const n = node(),
      m = new TraceRunModel(n.rpc, 'project-1', 'run-1', () => {})
    let resolve!: (value: unknown) => void
    n.request.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    const first = m.search('sample-old')
    await m.search('')
    resolve({ hits: [{ step: 't0001', name: 'sample', path: '$.id' }] })
    await first
    expect(m.valueMatches).toEqual([])
    n.request.mockResolvedValueOnce({ hits: [{ step: 't0002', name: 'sample', path: '$.id' }] })
    await m.search('sample-new')
    expect(m.valueMatches).toEqual(['t0002'])
    expect(n.request).toHaveBeenLastCalledWith('trace.v1.find', {
      project_id: 'project-1',
      run_id: 'run-1',
      value: 'sample-new',
      loose: true,
    })
  })
  it('reads every page of steps', async () => {
    const n = node()
    const m = new TraceRunModel(n.rpc, 'project-1', 'run-1', () => {})
    await m.load()
    expect(m.run?.steps.map((s) => s.id)).toEqual(['t0001', 't0002'])
    expect(m.run?.length).toBe('0.9 s')
  })

  it("opens at a record point's last hit, asked for before the steps have come", async () => {
    const n = node()
    const m = new TraceRunModel(n.rpc, 'project-1', 'run-1', () => {})
    const steps = (m as unknown as { rpc: TraceRpc }).rpc
    const wholeRun = steps.wholeRun.bind(steps)
    vi.spyOn(steps, 'wholeRun').mockImplementation(async (...args) => {
      const run = await wholeRun(...args)
      run.steps = run.steps.map((s, i) => ({ ...s, point: i === 0 ? 'bp-1' : 'bp-2' }))
      run.steps.push({ ...run.steps[0]!, id: 't0003', point: 'bp-1' })
      return run
    })
    m.pickPoint('bp-1')
    await m.load()
    expect(m.picked).toBe('t0003')
    await m.pickPoint('bp-2')
    expect(m.picked).toBe('t0002')
    // A point that gave nothing in this run leaves the pick alone.
    await m.pickPoint('bp-3')
    expect(m.picked).toBe('t0002')
  })

  it('asks for shapes and changes only of the step picked, once', async () => {
    const n = node()
    const m = new TraceRunModel(n.rpc, 'project-1', 'run-1', () => {})
    await m.load()
    expect(n.request.mock.calls.filter(([method]) => method === 'trace.v1.value')).toHaveLength(0)
    await m.pick('t0001')
    const [sample, gone] = m.step('t0001')!.values
    expect(sample!.shape).toEqual({
      type: 'object',
      children: [{ key: 'id', type: 'string', example: '"C-1"' }],
    })
    expect(sample!.changes?.summary).toBe('90% the same · 1 added')
    expect(sample!.text).toBeTruthy()
    expect(gone!.shape).toBeUndefined()
    const asked = n.request.mock.calls.length
    await m.pick('t0001')
    expect(n.request.mock.calls.length).toBe(asked)
    // A value the same as the last time has no changes to ask about.
    await m.pick('t0002')
    expect(
      n.request.mock.calls.filter(
        ([, p]) => (p as any).view === 'changes' && (p as any).step === 't0002'
      )
    ).toHaveLength(0)
  })

  it('follows a number as a number and marks a path of a value', async () => {
    const n = node()
    const m = new TraceRunModel(n.rpc, 'project-1', 'run-1', () => {})
    await m.load()
    await m.follow('20418')
    expect(n.request).toHaveBeenCalledWith('trace.v1.follow', {
      project_id: 'project-1',
      run_id: 'run-1',
      value: 20418,
    })
    await m.follow('"C-1"')
    expect(n.request).toHaveBeenLastCalledWith('trace.v1.follow', {
      project_id: 'project-1',
      run_id: 'run-1',
      value: 'C-1',
    })
    expect(m.trail?.stops).toEqual([{ step: 't0001', path: '$.id' }])
    await m.mark('t0001', 'sample/$.items', 'look here')
    expect(n.request).toHaveBeenLastCalledWith('trace.v1.mark', {
      project_id: 'project-1',
      run_id: 'run-1',
      step: 't0001',
      name: 'sample',
      path: '$.items',
      comment: 'look here',
    })
    expect(m.step('t0001')!.marked).toBe(true)
  })
})
