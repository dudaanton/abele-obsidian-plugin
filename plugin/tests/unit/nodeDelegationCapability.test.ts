import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeDelegationController } from '@/node/NodeDelegationController'

it.each([true, false])(
  'uses the real SDK against a fake node with grant-free delegation supported=%s',
  async (supported) => {
    const store = new NodeClientStore(crypto.randomUUID(), new IDBFactory())
    await store.transaction((s) => {
      s.node_id = 'sample-node'
    })
    const client = new NodeClient(
      { url: 'ws://localhost:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
      store
    )
    const wire = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'node.describe')
        return {
          providers: [{ provider: 'pi', available: true }],
          capabilities: {
            capabilities: supported ? { delegation_without_grant: { status: 'supported' } } : {},
          },
        }
      if (method === 'delegation.create')
        return {
          node_id: 'sample-node',
          session_id: 'sample-child',
          delegation_id: 'sample-delegation',
          delegation_key: params.delegation_key,
          parent_id: params.parent_id,
          grant_id: 'internal-binding',
          mailbox_stream_id: 'sample-mailbox',
          workspace_id: null,
          job_id: null,
          state: 'running',
          created_at: '2028-01-01T00:00:00Z',
        }
    })
    Object.assign(client, { channel: { request: wire } })
    vi.spyOn(client, 'subscribeDelegation').mockResolvedValue(undefined)
    const controller = new NodeDelegationController(client, store)
    try {
      const created = controller.create('sample-parent', {
        task_key: 'sample-task',
        project_id: 'sample-project',
        provider: 'pi',
        title: 'Sample task',
        text: 'Review the parser',
      })
      if (supported) {
        expect(await created).toMatchObject({ delegation_id: 'sample-delegation' })
        const call = wire.mock.calls.find(([method]) => method === 'delegation.create')!
        expect(call[1]).toMatchObject({ parent_id: 'sample-parent', project_id: 'sample-project' })
        expect(call[1]).not.toHaveProperty('grant_id')
        expect(await store.transaction((s) => s.outbox)).toEqual([])
      } else {
        await expect(created).rejects.toThrow('This node needs an update to take tasks from chats')
        expect(wire.mock.calls.some(([method]) => method === 'delegation.create')).toBe(false)
        expect(await controller.cards('sample-parent')).toEqual([])
      }
    } finally {
      store.close()
    }
  }
)
