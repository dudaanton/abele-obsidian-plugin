import { expect, it, vi } from 'vitest'
import { setupGit } from '../helpers/nodeAgentFixture'
const models = vi.hoisted(() => ({
  model: vi.fn(() => ({ projectId: 'sample-project' })),
  context: { value: undefined as unknown },
}))
vi.mock('@/requests/RequestsService', () => ({ RequestsService: { instance: () => models } }))
import { scopedRequestsContext } from '@/requests/agentContext'
import { nodeProjectGuard } from '@/ai/tools/node/projectAccess'

it('selects the granted worktree without an open Requests panel', async () => {
  const f = setupGit()
  f.session.overrides.value.nodeScope = [
    {
      kind: 'target',
      node_id: 'sample-node',
      project_id: 'sample-project',
      target: { kind: 'worktree', worktree_id: 'sample-tree' },
      access: 'read',
    },
  ]
  const context = await scopedRequestsContext({}, f.session, f.factory)
  expect(context?.worktreeId).toBe('sample-tree')
  expect(models.model).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: 'sample-project', worktreeId: 'sample-tree' })
  )
  const guard = await nodeProjectGuard(
    f.session,
    'http_requests',
    { ...context!, projectId: 'sample-project' },
    f.factory
  )
  guard()
})

it('uses the granted worktree when the Requests panel selected only its project', async () => {
  const f = setupGit()
  f.session.overrides.value.nodeScope = [
    {
      kind: 'target',
      node_id: 'sample-node',
      project_id: 'sample-project',
      target: { kind: 'worktree', worktree_id: 'sample-tree' },
      access: 'read',
    },
  ]
  models.context.value = { registrationId: 'sample-node', projectId: 'sample-project' }
  const context = await scopedRequestsContext({}, f.session, f.factory)
  expect(context?.worktreeId).toBe('sample-tree')
  await nodeProjectGuard(
    f.session,
    'http_requests',
    { ...context!, projectId: 'sample-project' },
    f.factory
  )
  await expect(
    scopedRequestsContext({ workspace: 'outside-tree' }, f.session, f.factory)
  ).rejects.toThrow()
})
