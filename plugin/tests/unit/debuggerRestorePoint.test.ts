import { expect, it, vi } from 'vitest'
import { restoreBreakpoint } from '@/debugger/restoreBreakpoint'
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
