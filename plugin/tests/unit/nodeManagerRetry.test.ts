import { expect, it, vi } from 'vitest'
import { NodeManagerController } from '@/node/NodeManagerController'
import { nodeManagerFixture } from '@/testing/nodeManagerFixture'

const setup = (state: Parameters<typeof nodeManagerFixture>[0]) => {
  const receipt = nodeManagerFixture('timed_out').run
  const params = {
    session_id: receipt.session_id,
    project_id: 'sample-project',
    argv: ['npm', 'test'],
  }
  const store = {
    read: async (fn: (value: unknown) => unknown) =>
      fn({
        managerOperations: {
          sample: { parent: 'sample-parent', method: 'command.v1.run', params },
        },
        results: { sample: { result: receipt } },
      }),
  }
  const controller = new NodeManagerController({ connected: true } as never, store as never)
  const status = vi.spyOn(controller, 'status').mockResolvedValue(nodeManagerFixture(state).run)
  const mutate = vi.spyOn(controller, 'mutate').mockResolvedValue(receipt)
  return { controller, status, mutate, params }
}
it.each([
  'outcome_unknown',
  'running',
  'pending_approval',
  'exited',
  'cancelled',
  'denied',
] as const)('never replays a command whose current result is %s', async (state) => {
  const f = setup(state)
  await expect(f.controller.retry('sample-parent', 'sample', 'sample-next')).rejects.toThrow()
  expect(f.mutate).not.toHaveBeenCalled()
})
it('checks the current result and creates a new receipt for a definitely ended failed run', async () => {
  const f = setup('timed_out')
  await f.controller.retry('sample-parent', 'sample', 'sample-next')
  expect(f.status).toHaveBeenCalledOnce()
  expect(f.mutate).toHaveBeenCalledWith('sample-parent', 'command.v1.run', f.params, 'sample-next')
})
it('refuses a different parent without reading command status or replaying it', async () => {
  const f = setup('timed_out')
  await expect(f.controller.retry('other-parent', 'sample', 'sample-next')).rejects.toThrow()
  expect(f.status).not.toHaveBeenCalled()
  expect(f.mutate).not.toHaveBeenCalled()
})
