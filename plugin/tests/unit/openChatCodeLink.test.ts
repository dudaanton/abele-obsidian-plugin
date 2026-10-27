import { expect, it, vi } from 'vitest'
import { nodeCodeLink } from '@/node/codeLinks'
import { chatCodeLinkTarget, openChatCodeLink } from '@/node/openChatCodeLink'
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
it('resolves absolute paths against accessible folder metadata and prefers the current folder', () => {
  const other = { ...scope, target: { kind: 'worktree' as const, worktree_id: 'other' } }
  const places = [
    {
      target: { node_id: scope.node_id, project_id: scope.project_id, target: scope.target },
      root: '/sample/tree',
    },
    {
      target: { node_id: other.node_id, project_id: other.project_id, target: other.target },
      root: '/sample/other',
      current: true,
    },
  ]
  expect(chatCodeLinkTarget('/sample/tree/src/sample.ts:3', [scope, other], places)).toEqual(
    places[0].target
  )
  expect(chatCodeLinkTarget('src/sample.ts:3', [scope, other], places)).toEqual(places[1].target)
  expect(chatCodeLinkTarget('/sample/tree/../secret.ts:3', [scope], places)).toBeUndefined()
  expect(chatCodeLinkTarget('/sample/other/src/sample.ts:3', [scope], places)).toBeUndefined()
})
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
