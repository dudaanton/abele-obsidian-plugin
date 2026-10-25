import { expect, it } from 'vitest'
import { ref } from 'vue'
import { coversNodeScope, NodeScopeLedger } from '@/ai/nodeScope'
import { requireDelegationScope } from '@/ai/tools/node/delegationScope'
const target = {
  node_id: 'sample-node',
  project_id: 'sample-project',
  target: { kind: 'workspace' as const, workspace_id: 'sample-folder' },
}
function chat(access: 'read' | 'edit' | 'run') {
  return {
    nodeScopeIdentity: 'sample-chat',
    overrides: ref({
      nodeScope: [
        {
          kind: 'project' as const,
          node_id: target.node_id,
          project_id: target.project_id,
          access,
        },
      ],
    }),
    conversationVersion: ref(0),
  }
}
it('run includes edits while edit never includes execution', () => {
  expect(coversNodeScope(chat('run').overrides.value.nodeScope[0], target, 'edit')).toBe(true)
  expect(coversNodeScope(chat('edit').overrides.value.nodeScope[0], target, 'run')).toBe(false)
})
it('uses synced scope on a fresh installation and fences scope changes', () => {
  const session = chat('edit')
  const guard = new NodeScopeLedger().guard(session, target, 'sample-principal', 'edit')
  guard()
  session.overrides.value.nodeScope = []
  expect(guard).toThrow()
})
it('requires run at the exact delegation target', () => {
  for (const level of ['read', 'edit'] as const)
    expect(() =>
      requireDelegationScope(
        chat(level) as never,
        target.node_id,
        target.project_id,
        'sample-folder'
      )
    ).toThrow()
  expect(() =>
    requireDelegationScope(chat('run') as never, target.node_id, target.project_id, 'sample-folder')
  ).not.toThrow()
})
