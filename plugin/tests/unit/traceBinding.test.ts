import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DebuggerClient } from '@abele/node-client'
import { DebuggerBinding } from '@/debugger/DebuggerService'
import { debuggerSnapshot, debuggerStatus } from '../fixtures/debugger'
import type { NodeConnection } from '@/node/NodeService'

function connection(records: boolean, stop: string[] = []) {
  const rpc = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'debugger.v1.status')
      return debuggerStatus({
        threads: [
          {
            thread_id: 1,
            name: 'main',
            status: 'stopped',
            stop: { reason: 'breakpoint', hit_breakpoint_ids: stop, location: null },
          },
        ],
      })
    if (method === 'debugger.v1.wait') return new Promise(() => {})
    if (method === 'debugger.v1.cancelWait') return { cancelled: true }
    throw new Error(`Unexpected sample RPC ${method}`)
  })
  const describe = vi.fn(async () => ({
    capabilities: {
      capabilities: records ? { trace_v1: { status: 'supported', evidence: 'sample' } } : {},
    },
  }))
  return {
    rpc,
    connection: {
      state: ref('connected'),
      client: { request: rpc, describe, debugger: new DebuggerClient(rpc) },
    } as unknown as NodeConnection,
  }
}

async function opened(records: boolean, stop: string[] = []) {
  const c = connection(records, stop)
  const binding = new DebuggerBinding(c.connection, 'sample-chat', 'sample-registration')
  const refresh = vi.spyOn(binding, 'refresh').mockResolvedValue(undefined)
  await binding.open('sample-debug')
  refresh.mockRestore()
  return { binding, ...c }
}

describe('a debugger session on a node that records runs', () => {
  it('gets its recording only where the node says it records', async () => {
    const on = await opened(true)
    const off = await opened(false)
    try {
      expect(on.binding.trace).toBeDefined()
      expect(off.binding.trace).toBeUndefined()
    } finally {
      on.binding.destroy()
      off.binding.destroy()
    }
  })

  it('does not read the frames of a stop on record points, which the program has already left', async () => {
    const { binding } = await opened(true, ['sample-record'])
    try {
      const trace = binding.trace!
      vi.spyOn(trace, 'refresh').mockResolvedValue(undefined)
      trace.points = [{ breakpoint_id: 'sample-record', take: ['sample'] }]
      const c = binding.controller
      vi.spyOn(c, 'refreshApprovals').mockResolvedValue(undefined as never)
      vi.spyOn(c, 'refreshHistory').mockResolvedValue(undefined)
      vi.spyOn(c, 'refreshOutput').mockResolvedValue(undefined)
      const stack = vi.spyOn(c, 'loadStack').mockResolvedValue(undefined as never)
      await binding.refresh()
      expect(trace.refresh).toHaveBeenCalled()
      expect(stack).not.toHaveBeenCalled()
      // A stop on an ordinary breakpoint is still looked at.
      trace.points = []
      c.observe({
        observation: 'current',
        snapshot: debuggerSnapshot({ event_seq: 9, stop_epoch: 4 }),
      })
      await binding.refresh()
      expect(stack).toHaveBeenCalled()
    } finally {
      binding.destroy()
    }
  })
})

vi.mock('@/debugger/trace/panel', () => ({ openRun: vi.fn() }))

describe('a program that ends while it records', () => {
  it('reads its runs once more and opens the run it left in its tab', async () => {
    const { openRun } = await import('@/debugger/trace/panel')
    let recording = true
    let waited = 0
    let programEnds = () => {}
    const ended = new Promise<void>((resolve) => (programEnds = resolve))
    const c = connection(true)
    c.rpc.mockImplementation(async (method: string, params: any): Promise<unknown> => {
      switch (method) {
        case 'debugger.v1.status':
          return debuggerStatus()
        case 'debugger.v1.wait':
          // The first wait sees the program go: its connection is lost.
          if (++waited > 1) return new Promise(() => {})
          await ended
          return {
            wait_id: params.wait_id,
            reason: 'connection_lost',
            elapsed_ms: 0,
            snapshot: null,
          }
        case 'debugger.v1.cancelWait':
          return { cancelled: true }
        case 'trace.v1.points.list':
          return { points: [] }
        case 'trace.v1.status':
          return {
            folder: '/sample/runs',
            chosen: true,
            recording: recording
              ? { run_id: 'run-1', steps: 3, started_at: '2026-01-02T03:04:05.000Z' }
              : null,
          }
        case 'trace.v1.runs':
          return {
            folder: '/sample/runs',
            chosen: true,
            runs: [
              {
                id: 'run-1',
                name: 'Sample run',
                debug_session_id: 'sample-debug',
                started_at: '2026-01-02T03:04:05.000Z',
                state: recording ? 'recording' : 'done',
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
              state: 'done',
              steps: 3,
              bytes: 10,
            },
            points: [],
            steps: [],
            marks: [],
            folder: '/sample/runs',
          }
      }
      return {}
    })
    const binding = new DebuggerBinding(c.connection, 'sample-chat', 'sample-registration')
    for (const m of ['refreshApprovals', 'refreshHistory', 'refreshOutput', 'loadStack'] as const)
      vi.spyOn(binding.controller, m).mockResolvedValue(undefined)
    try {
      await binding.open('sample-debug')
      expect(binding.trace?.status?.recording?.run_id).toBe('run-1')
      recording = false
      programEnds()
      await vi.waitFor(() => expect(openRun).toHaveBeenCalledWith(binding, 'run-1'))
      expect(c.rpc.mock.calls.some(([m]) => /note/i.test(String(m)))).toBe(false)
    } finally {
      binding.destroy()
    }
  })
})
