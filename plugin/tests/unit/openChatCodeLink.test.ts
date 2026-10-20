import { expect, it, vi } from 'vitest'
import { nodeCodeLink } from '@/node/codeLinks'
import { openChatCodeLink } from '@/node/openChatCodeLink'
const { open } = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('@/node/openToolFile', () => ({ openNodeToolFile: open }))
const target = {
  nodeId: 'node',
  registrationId: 'registration',
  projectId: 'project',
  kind: 'worktree' as const,
  id: 'tree',
}
const scope = {
  kind: 'target' as const,
  node_id: 'node',
  project_id: 'project',
  target: { kind: 'worktree' as const, worktree_id: 'tree' },
  access: 'read' as const,
}
it('opens only covered destinations and refuses ambiguous relative citations', async () => {
  open.mockClear()
  const link = nodeCodeLink(target, 'src/sample.ts', { start: 3, end: 7 })
  await openChatCodeLink(link, [scope])
  expect(open).toHaveBeenCalledWith(link, {
    node_id: 'node',
    project_id: 'project',
    target: scope.target,
  })
  open.mockClear()
  await openChatCodeLink(link, [])
  await openChatCodeLink(nodeCodeLink({ ...target, id: 'other' }, 'src/sample.ts'), [scope])
  await openChatCodeLink('src/sample.ts:3', [scope, { ...scope, project_id: 'other' }])
  expect(open).not.toHaveBeenCalled()
})
