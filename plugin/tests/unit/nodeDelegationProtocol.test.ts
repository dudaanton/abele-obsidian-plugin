import { expect, it } from 'vitest'
import { MemoryClientStore, NodeClient } from '@abele/node-client'
import { DelegationStatusSchema, DelegationTerminalSchema } from '@abele/node-protocol'

const child = {
  node_id: 'sample-node',
  session_id: 'sample-child',
  delegation_id: 'sample-delegation',
  delegation_key: 'sample-key',
  grant_id: 'sample-grant',
  parent_id: 'sample-parent',
  mailbox_stream_id: 'sample-mailbox',
  workspace_id: null,
  job_id: null,
  state: 'failed',
  created_at: '2028-01-01T00:00:00Z',
  session_head_seq: 0,
  mailbox_head_seq: 1,
  pending_human_prompts: 0,
}
it.each(['time_limit', 'interactive_approval_unsupported', 'pi_worker_lost', 'future_reason'])(
  'accepts status and terminal reason %s without dropping mailbox events',
  async (reason) => {
    expect(DelegationStatusSchema.parse({ ...child, reason }).reason).toBe(reason)
    expect(
      DelegationTerminalSchema.parse({
        delegation_id: child.delegation_id,
        session_id: child.session_id,
        state: 'failed',
        reason,
      }).reason
    ).toBe(reason)
    const store = new MemoryClientStore()
    await store.transaction((s) => {
      s.node_id = child.node_id
    })
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:12345/channel', profile: 'local-token-v1', token: 'sample-token' },
      store
    )
    await client.ingest({
      kind: 'event',
      node_id: child.node_id,
      stream_id: child.mailbox_stream_id,
      seq: 1,
      actor: { kind: 'node' },
      at: child.created_at,
      type: 'delegation.terminal',
      data: {
        delegation_id: child.delegation_id,
        session_id: child.session_id,
        state: 'failed',
        reason,
      },
    })
    expect(await client.cursor(child.mailbox_stream_id)).toBe(1)
  }
)
it('continues rejecting malformed terminal reasons', () => {
  expect(
    DelegationTerminalSchema.safeParse({
      delegation_id: child.delegation_id,
      session_id: child.session_id,
      state: 'failed',
      reason: 42,
    }).success
  ).toBe(false)
})
