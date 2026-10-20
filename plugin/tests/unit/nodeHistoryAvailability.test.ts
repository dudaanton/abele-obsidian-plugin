import { expect, it } from 'vitest'
import { ref } from 'vue'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodeConnection } from '@/node/NodeService'
const create = (advertised: boolean) => {
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    new MemoryClientStore()
  )
  Object.assign(client, {
    channel: {
      channel: {
        welcome: {
          methods: advertised ? ['chat.checkpoints', 'chat.preview', 'chat.restore'] : [],
        },
      },
    },
  })
  const p = new NodeChatPresenter(
    {
      kind: 'node-session',
      nodeId: 'sample',
      registrationId: 'sample-registration',
      sessionId: 'session',
      title: 'Sample',
    },
    { client, state: ref('connected'), error: ref('') } as unknown as NodeConnection
  )
  p.projection.value.session = {
    session_id: 'session',
    provider: 'pi',
    title: 'Sample',
    created_at: new Date(0).toISOString(),
  }
  p.projection.value.messages = [
    { id: 'input:first', role: 'user', content: 'Sample question', timestamp: 0 },
  ]
  p.history.checkpoints.value = [
    { checkpoint_id: 'point', input_id: 'first', before_seq: 1, exclude_input_ids: [] },
  ]
  return p
}
it('hides native history controls on old nodes rather than trying unknown methods', () => {
  const p = create(false)
  try {
    expect(p.capabilities.rewind).toBe(false)
    expect(p.historyState('input:first')).toBeUndefined()
  } finally {
    p.destroy()
  }
})
it('explains an unbound legacy chat and enables only idle explicitly bound chats', () => {
  const p = create(true)
  try {
    p.binding.value = null
    expect(p.historyState('input:first')?.reason).toContain('explicit folder or worktree')
    p.binding.value = {
      project_id: 'project',
      target: { kind: 'worktree', worktree_id: 'tree' },
      incarnation: 'binding',
    } as never
    expect(p.historyState('input:first')?.reason).toBe('')
    expect(p.capabilities).toMatchObject({ rewind: true, branches: true, editHistory: true })
    p.projection.value.activeRuns = ['process']
    expect(p.historyState('input:first')?.reason).toContain('Stop the agent')
  } finally {
    p.destroy()
  }
})
