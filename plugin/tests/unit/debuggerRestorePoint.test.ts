import { expect, it, vi } from 'vitest'
import { restoreBreakpoint } from '@/debugger/restoreBreakpoint'
import {
  removeForgottenBreakpoints,
  forgottenBreakpointLocations,
} from '@/debugger/restoreBreakpoint'

it('holds restored points even before their recording metadata reaches the local cache', async () => {
  const session = { status: 'running' }
  const snapshot = { stop_epoch: 1, selected_thread_id: 1, threads: [] as any[] }
  const command = vi.fn(async (action: string) => {
    session.status = action === 'pause' ? 'paused' : 'running'
    if (action === 'pause') snapshot.threads = [{ thread_id: 1, stop: { reason: 'pause' } }]
    return { outcome: 'completed' }
  })
  const removeBreakpoint = vi.fn(async (_id: string) => ({ outcome: 'completed' }))
  const removePoint = vi.fn(async (id: string) => {
    await removeBreakpoint(id)
  })
  await removeForgottenBreakpoints(
    undefined,
    {
      controller: {
        current: true,
        session,
        snapshot,
        command,
        removeBreakpoint,
        knownBreakpoints: () => [{ id: 'sample-restored', file: 'sample.ts', requestedLine: 4 }],
      },
      trace: { points: [], isRecordStop: () => false, removePoint },
    } as never,
    [{ file: 'sample.ts', requestedLine: 4 }]
  )
  expect(command.mock.calls.map(([action]) => action)).toEqual(['pause', 'continue'])
  expect(removeBreakpoint).toHaveBeenCalledExactlyOnceWith('sample-restored')
  expect(removePoint).toHaveBeenCalledExactlyOnceWith('sample-restored')
})
it.each(['pending', 'rejected', 'outcome_unknown'])(
  'does not resume when forgotten breakpoint removal is %s',
  async (outcome) => {
    const command = vi.fn()
    const controller = {
      current: true,
      session: { status: 'paused' },
      command,
      snapshot: {
        stop_epoch: 7,
        selected_thread_id: 1,
        threads: [
          { thread_id: 1, stop: { reason: 'breakpoint', hit_breakpoint_ids: ['sample-new'] } },
        ],
      },
      knownBreakpoints: () => [{ id: 'sample-new', file: 'sample.ts', requestedLine: 5 }],
      removeBreakpoint: vi.fn(async () => ({ outcome })),
    }
    await expect(
      removeForgottenBreakpoints(undefined, { controller } as never, [
        { file: 'sample.ts', requestedLine: 5 },
      ])
    ).rejects.toThrow()
    expect(command).not.toHaveBeenCalled()
  }
)
it.each([false, true])(
  'resumes a restored forgotten stop only when every hit was removed (mixed: %s)',
  async (mixed) => {
    const session = { status: 'paused' }
    const removePoint = vi.fn(async () => {})
    const command = vi.fn(async () => {
      session.status = 'running'
    })
    const next = {
      controller: {
        current: true,
        session,
        command,
        snapshot: {
          stop_epoch: 7,
          selected_thread_id: 1,
          threads: [
            {
              thread_id: 1,
              stop: {
                reason: 'breakpoint',
                hit_breakpoint_ids: mixed ? ['sample-new', 'sample-other'] : ['sample-new'],
              },
            },
          ],
        },
        knownBreakpoints: () => [{ id: 'sample-new', file: 'sample.ts', requestedLine: 5 }],
        removeBreakpoint: removePoint,
      },
      // The node restored the breakpoint before its record metadata, so it is a plain stop.
      trace: { points: [], isRecordStop: () => false, removePoint },
    }
    await removeForgottenBreakpoints(undefined, next as never, [
      { file: 'sample.ts', requestedLine: 5 },
    ])
    expect(command.mock.calls).toEqual(mixed ? [] : [['continue']])
  }
)
it.each([
  { changedStop: false, lateStop: false },
  { changedStop: true, lateStop: false },
  { changedStop: false, lateStop: true },
])(
  'holds a running record session steady and resumes only its own settled pause (%j)',
  async ({ changedStop, lateStop }) => {
    const session = { status: 'running' }
    const snapshot = {
      stop_epoch: 4,
      selected_thread_id: 1,
      threads: [{ thread_id: 1, stop: { reason: 'pause' } }],
    }
    const command = vi.fn(async (action: string) => {
      if (action === 'pause') {
        const stopped = () => {
          session.status = 'paused'
          snapshot.stop_epoch++
        }
        if (lateStop) window.setTimeout(stopped, 20)
        else stopped()
      } else session.status = 'running'
      return { outcome: 'completed' }
    })
    const removePoint = vi.fn(async () => {
      expect(session.status).toBe('paused')
      if (changedStop) snapshot.stop_epoch++
    })
    const next = {
      controller: {
        current: true,
        session,
        snapshot,
        command,
        knownBreakpoints: () => [{ id: 'sample-new', file: 'sample.ts', requestedLine: 5 }],
      },
      trace: { points: [{ breakpoint_id: 'sample-new' }], isRecordStop: () => false, removePoint },
    }
    await removeForgottenBreakpoints(undefined, next as never, [
      { file: 'sample.ts', requestedLine: 5 },
    ])
    expect(command.mock.calls.map(([action]) => action)).toEqual(
      changedStop ? ['pause'] : ['pause', 'continue']
    )
    expect(removePoint).toHaveBeenCalledExactlyOnceWith('sample-new')
  }
)
it('captures removed locations before a chat binding is reused for the new session', async () => {
  let known = [{ id: 'sample-old', file: 'src/sample.ts', requestedLine: 5 }]
  const removeBreakpoint = vi.fn(async () => {})
  const binding = {
    forgottenBreakpoints: new Set(['sample-old']),
    controller: {
      knownBreakpoints: () => known,
      removeBreakpoint,
    },
  }
  const removed = forgottenBreakpointLocations(binding as never)
  known = [{ id: 'sample-new', file: 'src/sample.ts', requestedLine: 5 }]
  await removeForgottenBreakpoints(binding as never, binding as never, removed)
  expect(removeBreakpoint).toHaveBeenCalledExactlyOnceWith('sample-new')
})
it('removes points forgotten while detached from a node-restored session before carrying intent', async () => {
  const removeBreakpoint = vi.fn(async () => {})
  const previous = {
    forgottenBreakpoints: new Set(['sample-old']),
    controller: {
      knownBreakpoints: () => [{ id: 'sample-old', file: 'src/sample.ts', requestedLine: 5 }],
    },
  }
  const next = {
    controller: {
      knownBreakpoints: () => [
        { id: 'sample-new', file: 'src/sample.ts', requestedLine: 5 },
        { id: 'sample-other', file: 'src/sample.ts', requestedLine: 8 },
      ],
      removeBreakpoint,
    },
  }
  await removeForgottenBreakpoints(previous as never, next as never)
  expect(removeBreakpoint).toHaveBeenCalledExactlyOnceWith('sample-new')
})
it('reuses a point restored by the node instead of duplicating it, and preserves disabled intent', async () => {
  const setBreakpoint = vi.fn(async () => {})
  const controller = {
    snapshot: {
      breakpoints: [
        { breakpoint_id: 'sample-existing', source_id: 'sample-source', line: 5, enabled: true },
      ],
    },
    setBreakpoint,
  }
  const point = { requestedLine: 5, enabled: true }
  await restoreBreakpoint(controller as never, 'sample-source', point)
  expect(setBreakpoint).not.toHaveBeenCalled()
  await restoreBreakpoint(controller as never, 'sample-source', { ...point, enabled: false })
  expect(setBreakpoint).toHaveBeenCalledWith('sample-existing', 'sample-source', 5, undefined, {
    enabled: false,
    hit_condition: undefined,
    log_message: undefined,
  })
})
