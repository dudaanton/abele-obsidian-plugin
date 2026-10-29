import { expect, it, vi } from 'vitest'
import { restoreBreakpoint } from '@/debugger/restoreBreakpoint'
import {
  removeForgottenBreakpoints,
  forgottenBreakpointLocations,
} from '@/debugger/restoreBreakpoint'
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
