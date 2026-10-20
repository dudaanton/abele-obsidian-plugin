import { describe, expect, it, vi } from 'vitest'
import { TraceSession, type TraceBreakpoints } from '@/debugger/trace/TraceSession'
import { TraceRpc } from '@/debugger/trace/wire'
import type { DebuggerSnapshot } from '@abele/node-protocol'

it('refreshes recording state after removing the final point', async () => {
  const s = new TraceSession(fakeNode().rpc, fakeDebugger(), () => {})
  await s.savePoint('sample-source', 4, { take: ['sample'] })
  expect(s.recording()).toBeDefined()
  await s.removePoint(s.points[0].breakpoint_id)
  expect(s.recording()).toBeUndefined()
  s.dispose()
})

it('does not list runs with no recorded evidence', async () => {
  const s = new TraceSession(fakeNode().rpc, fakeDebugger(), () => {})
  await s.refresh()
  s.runs[0].steps = 0
  expect(s.summaries()).toEqual([])
  s.dispose()
})

// TraceSession reads only the session's identity and its project from the snapshot.
const snapshot = () =>
  ({
    debug_session_id: 'sample-debug',
    target: { project_id: 'sample-project' },
  }) as unknown as DebuggerSnapshot

/** A node that keeps record points and one run in memory, answering as `trace.v1` does. */
function fakeNode() {
  const calls: { method: string; params: any }[] = []
  let points: { breakpoint_id: string; take: string[]; note?: string }[] = []
  const request = vi.fn(async (method: string, params: any) => {
    calls.push({ method, params })
    switch (method) {
      case 'trace.v1.points.list':
        return { points }
      case 'trace.v1.points.set':
        points = [
          ...points.filter(
            (p) =>
              !params.remove.includes(p.breakpoint_id) &&
              !params.upsert.some((u: any) => u.breakpoint_id === p.breakpoint_id)
          ),
          ...params.upsert,
        ]
        return { points }
      case 'trace.v1.status':
        return {
          folder: '/sample/project/.abele/runs',
          chosen: false,
          recording: points.length
            ? { run_id: 'run-1', steps: 3, started_at: new Date(Date.now() - 5000).toISOString() }
            : null,
        }
      case 'trace.v1.runs':
        return {
          folder: '/sample/project/.abele/runs',
          chosen: false,
          runs: [
            {
              id: 'run-1',
              name: 'Sample run',
              debug_session_id: 'sample-debug',
              started_at: '2026-01-02T03:04:05.000Z',
              state: 'recording',
              steps: 3,
              bytes: 10,
            },
          ],
        }
      case 'trace.v1.run':
        return {
          run: {
            id: 'run-1',
            name: 'Sample run',
            debug_session_id: 'sample-debug',
            started_at: '2026-01-02T03:04:05.000Z',
            state: 'recording',
            steps: 3,
            bytes: 10,
          },
          points: points.map((p) => ({
            ...p,
            file: 'src/sample.ts',
            line: 4,
            hits: 3,
            last: 'sample { items: 2 }',
          })),
          steps: [],
          marks: [],
          folder: '/sample/project/.abele/runs',
        }
      case 'trace.v1.folder.set':
        return { folder: params.folder, chosen: true }
    }
    throw new Error(`unexpected ${method}`)
  })
  return { request, calls, rpc: new TraceRpc(request) }
}

function fakeDebugger(existing: { id: string; line: number; condition?: string }[] = []) {
  const known = existing.map((b) => ({
    id: b.id,
    sourceId: 'sample-source',
    file: 'src/sample.ts',
    line: b.line,
    requestedLine: b.line,
    state: 'set' as const,
    ...(b.condition ? { condition: b.condition } : {}),
  }))
  const debug: TraceBreakpoints & { known: typeof known } = {
    known,
    snapshot: snapshot(),
    knownBreakpoints: () => known,
    setBreakpoint: vi.fn(async (id, sourceId, line, condition) => {
      const at = known.findIndex((k) => k.id === id)
      const next = {
        id,
        sourceId,
        file: 'src/sample.ts',
        line,
        requestedLine: line,
        state: 'set' as const,
        ...(condition ? { condition } : {}),
      }
      if (at >= 0) known[at] = next
      else known.push(next)
    }),
    removeBreakpoint: vi.fn(async (id) => {
      known.splice(
        known.findIndex((k) => k.id === id),
        1
      )
    }),
  }
  return debug
}

describe('setting up a record point', () => {
  it('tells the source editor when a conditional point still needs approval', async () => {
    const node = fakeNode(),
      debug = fakeDebugger()
    vi.mocked(debug.setBreakpoint).mockResolvedValueOnce({ outcome: 'pending' })
    const trace = new TraceSession(node.rpc, debug, () => {})
    try {
      await expect(
        trace.savePoint('sample-source', 4, { take: ['n'], when: 'n < 4 && n > 0' })
      ).resolves.toEqual({ pending: true })
    } finally {
      trace.dispose()
    }
  })
  it('reports a refused conditional breakpoint instead of claiming the record point was saved', async () => {
    const node = fakeNode(),
      debug = fakeDebugger()
    vi.mocked(debug.setBreakpoint).mockResolvedValueOnce({
      outcome: 'rejected',
      code: 'build_identity_unverified',
    })
    const trace = new TraceSession(node.rpc, debug, () => {})
    try {
      await expect(
        trace.savePoint('sample-source', 4, { take: ['n'], when: 'n > 0 && n < 4' })
      ).rejects.toThrow(/record point.*not saved/i)
    } finally {
      trace.dispose()
    }
  })
  it('sends what to take before the breakpoint, so a hit never comes first', async () => {
    const node = fakeNode()
    const debug = fakeDebugger()
    const order: string[] = []
    node.request.mockImplementationOnce(async (method, params) => {
      order.push(method)
      return { points: params.upsert }
    })
    ;(debug.setBreakpoint as any).mockImplementationOnce(async () => order.push('breakpoint'))
    const s = new TraceSession(node.rpc, debug, () => {})
    await s.savePoint('sample-source', 4, { take: ['sample'], note: ' Sample read ' })
    expect(order).toEqual(['trace.v1.points.set', 'breakpoint'])
    const sent = node.request.mock.calls[0]![1].upsert[0]
    expect(sent).toMatchObject({ take: ['sample'], note: 'Sample read' })
    expect(debug.setBreakpoint).toHaveBeenCalledWith(
      sent.breakpoint_id,
      'sample-source',
      4,
      undefined
    )
  })

  it('turns a breakpoint already on the line into a record point without setting it again', async () => {
    const node = fakeNode()
    const debug = fakeDebugger([{ id: 'bp-1', line: 4 }])
    const s = new TraceSession(node.rpc, debug, () => {})
    await s.savePoint('sample-source', 4, { take: ['sample'] })
    expect(debug.setBreakpoint).not.toHaveBeenCalled()
    expect(s.breakpoints()).toEqual([
      expect.objectContaining({ line: 4, kind: 'record', take: ['sample'], hits: 3 }),
    ])
    // A new condition goes with the breakpoint, through its usual approval.
    await s.savePoint('sample-source', 4, { take: ['sample'], when: 'sample.ok' })
    expect(debug.setBreakpoint).toHaveBeenCalledWith('bp-1', 'sample-source', 4, 'sample.ok')
  })

  it('makes a record point a breakpoint again, or removes both', async () => {
    const node = fakeNode()
    const debug = fakeDebugger([
      { id: 'bp-1', line: 4 },
      { id: 'bp-2', line: 9 },
    ])
    const s = new TraceSession(node.rpc, debug, () => {})
    await s.savePoint('sample-source', 4, { take: ['a'] })
    await s.savePoint('sample-source', 9, { take: ['b'] })
    await s.toBreakpoint('bp-1')
    expect(s.breakpoints().map((b) => b.kind)).toEqual([undefined, 'record'])
    await s.removePoint('bp-2')
    expect(debug.removeBreakpoint).toHaveBeenCalledWith('bp-2')
    expect(s.points).toEqual([])
  })
})

describe('what the panel shows of a recording', () => {
  it('reads the run being written and the runs of the project', async () => {
    const node = fakeNode()
    const debug = fakeDebugger([{ id: 'bp-1', line: 4 }])
    const changed = vi.fn()
    const s = new TraceSession(node.rpc, debug, changed)
    await s.refresh()
    expect(s.recording()).toBeUndefined()
    await s.savePoint('sample-source', 4, { take: ['sample'] })
    expect(s.recording()).toMatchObject({ steps: 3, folder: '/sample/project/.abele/runs' })
    expect(s.summaries()).toEqual([
      expect.objectContaining({ id: 'run-1', name: 'Sample run', steps: 3 }),
    ])
    expect(s.pointAt('sample-source', 4)?.id).toBe('bp-1')
    expect(s.pointAt('sample-source', 5)).toBeUndefined()
    expect(changed).toHaveBeenCalled()
  })
})

describe('a stop on record points', () => {
  it('is told apart from a stop the person has to look at', async () => {
    const node = fakeNode()
    const debug = fakeDebugger([
      { id: 'bp-1', line: 4 },
      { id: 'bp-2', line: 9 },
    ])
    const s = new TraceSession(node.rpc, debug, () => {})
    await s.savePoint('sample-source', 4, { take: ['a'] })
    const stopped = (hits: string[]) =>
      ({
        ...snapshot(),
        selected_thread_id: 1,
        threads: [{ thread_id: 1, stop: { hit_breakpoint_ids: hits } }],
      }) as unknown as DebuggerSnapshot
    expect(s.isRecordStop(stopped(['bp-1']))).toBe(true)
    expect(s.isRecordStop(stopped(['bp-1', 'bp-2']))).toBe(false)
    expect(s.isRecordStop(stopped([]))).toBe(false)
  })
})

describe('a run that ends', () => {
  it('is handed on once, when the run being written is written no more, and never as a note', async () => {
    const node = fakeNode()
    const s = new TraceSession(node.rpc, fakeDebugger([{ id: 'bp-1', line: 4 }]), () => {})
    const ended = vi.fn()
    s.onRunEnded(ended)
    await s.savePoint('sample-source', 4, { take: ['sample'] })
    expect(s.status?.recording?.run_id).toBe('run-1')
    expect(ended).not.toHaveBeenCalled()
    // The program stopped: the node has no run in writing now.
    await s.removePoint('bp-1')
    await s.refresh()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledWith('run-1')
    await s.refresh()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(node.calls.some((c) => /note/i.test(c.method))).toBe(false)
  })
})

describe('reading the runs again', () => {
  it('joins a read under way, so a read that must be fresh waits for it and reads once more', async () => {
    const node = fakeNode()
    const s = new TraceSession(node.rpc, fakeDebugger(), () => {})
    const first = s.refresh()
    expect(s.refresh()).toBe(first)
    await first
    const before = node.calls.length
    await s.refresh()
    expect(node.calls.length).toBeGreaterThan(before)
  })
})

describe('a run being written', () => {
  it('is read again every two seconds until the node has closed it, and no longer once disposed', async () => {
    vi.useFakeTimers()
    try {
      const node = fakeNode()
      const s = new TraceSession(node.rpc, fakeDebugger([{ id: 'bp-1', line: 4 }]), () => {})
      const ended = vi.fn()
      s.onRunEnded(ended)
      await s.savePoint('sample-source', 4, { take: ['sample'] })
      const reads = () => node.calls.filter((c) => c.method === 'trace.v1.status').length
      const before = reads()
      await vi.advanceTimersByTimeAsync(2100)
      expect(reads()).toBe(before + 1)
      // The node closes the run (here: its points go) and the next read sees it.
      node.request.mockClear()
      await s.removePoint('bp-1')
      await vi.advanceTimersByTimeAsync(2100)
      expect(ended).toHaveBeenCalledWith('run-1')
      const after = reads()
      await vi.advanceTimersByTimeAsync(6000)
      expect(reads()).toBe(after)
      s.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
