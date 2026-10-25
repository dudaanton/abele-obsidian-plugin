// Folder execution levels replace the former separate action switches.
import { expect, it } from 'vitest'
import { ref } from 'vue'
import { requireDelegationScope } from '@/ai/tools/node/delegationScope'
import type { ChatSession } from '@/ai/ChatSession'
const chat = (scope: unknown[]) => ({ overrides: ref({ nodeScope: scope }) }) as ChatSession
it('allows node and project access without a separate delegation grant', () => {
  for (const kind of ['node', 'project']) {
    const session = chat([
      {
        kind,
        node_id: 'sample-node',
        ...(kind === 'project' ? { project_id: 'sample-project' } : {}),
        access: 'run',
      },
    ])
    expect(() => requireDelegationScope(session, 'sample-node', 'sample-project')).not.toThrow()
  }
})
it('refuses missing nodes and other projects with instructions for the node chips', () => {
  const session = chat([
    { kind: 'project', node_id: 'sample-node', project_id: 'sample-project', access: 'run' },
  ])
  expect(() => requireDelegationScope(session, 'other-node', 'sample-project')).toThrow(
    /node chips/i
  )
  expect(() => requireDelegationScope(session, 'sample-node', 'other-project')).toThrow(
    /node chips/i
  )
})
it('rechecks scope after it changes', () => {
  const session = chat([{ kind: 'node', node_id: 'sample-node', access: 'run' }])
  const guard = requireDelegationScope(session, 'sample-node', 'sample-project')
  session.overrides.value.nodeScope = []
  expect(guard).toThrow(/node chips/i)
})
