import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { NodeClient, Delegation, DelegationGrant } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeDelegationController } from '@/node/NodeDelegationController'

const grant: DelegationGrant = {
  grant_id: 'grant',
  installation_id: 'installation',
  approved_by: 'installation',
  parent_id: 'parent',
  project_ids: ['project'],
  providers: ['pi', 'claude', 'fake'],
  actions: ['create', 'send', 'status', 'cancel', 'read'],
  allow_fake: true,
  created_at: '2028-01-01T00:00:00Z',
  revoked: false,
}
const child: Delegation = {
  node_id: 'node',
  session_id: 'child',
  delegation_id: 'delegation',
  delegation_key: 'key',
  grant_id: 'grant',
  parent_id: 'parent',
  mailbox_stream_id: 'mailbox',
  workspace_id: null,
  job_id: null,
  state: 'running',
  created_at: '2028-01-01T00:00:00Z',
}
const task = {
  task_key: 'parser-task',
  project_id: 'project',
  provider: 'pi' as const,
  title: 'Sample task',
  text: 'Review parser',
}
function fixture() {
  const factory = new IDBFactory()
  const store = new NodeClientStore('sample-delegation', factory)
  const client = {
    connected: true,
    store,
    describe: vi.fn(async () => ({
      providers: [
        { provider: 'pi', available: true },
        { provider: 'fake', available: true },
      ],
    })),
    createDelegation: vi.fn(async (request) => ({
      ...child,
      delegation_key: request.delegation_key,
    })),
    subscribeDelegation: vi.fn(async () => {}),
    delegationStatus: vi.fn(async () => ({
      ...child,
      session_head_seq: 17,
      mailbox_head_seq: 2,
      pending_human_prompts: 1,
    })),
    sendDelegation: vi.fn(async () => ({ input_id: 'input', accepted_seq: 18 })),
    cancelDelegation: vi.fn(async () => ({ ...child, state: 'cancelled' })),
    approveDelegationGrant: vi.fn(async () => grant),
    revokeDelegationGrant: vi.fn(async () => ({ ...grant, revoked: true })),
  }
  return {
    factory,
    store,
    client,
    controller: new NodeDelegationController(client as unknown as NodeClient, store),
  }
}
describe('trusted node delegation controller', () => {
  it('requires explicit owner approval and returns only approved destinations', async () => {
    const f = fixture()
    await expect(f.controller.create('parent', task)).rejects.toThrow(/grant/i)
    expect(f.client.createDelegation).not.toHaveBeenCalled()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    expect(await f.controller.destinations('other')).toEqual([])
    expect(JSON.stringify(await f.controller.destinations('parent'))).not.toContain('grant_id')
    await f.controller.create('parent', task)
    expect(f.client.createDelegation.mock.calls[0][0].grant_id).toBe('grant')
  })
  it('preserves the exact task key/body across uncertain responses and restart', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    f.client.createDelegation.mockRejectedValueOnce(new Error('outcome_unknown'))
    await expect(f.controller.create('parent', task)).rejects.toThrow('outcome_unknown')
    const first = f.client.createDelegation.mock.calls[0][0]
    const reopened = new NodeClientStore('sample-delegation', f.factory)
    const resumed = new NodeDelegationController(f.client as unknown as NodeClient, reopened)
    await expect(resumed.create('parent', { ...task, text: 'Changed body' })).rejects.toThrow(
      /mismatch/
    )
    await resumed.create('parent', task)
    expect(f.client.createDelegation.mock.calls[1][0]).toEqual(first)
    expect(first.delegation_key.length).toBeLessThanOrEqual(128)
    f.store.close()
    reopened.close()
  })
  it('reconciles a lost create receipt and projects one durable offline result on every reload', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    f.client.createDelegation.mockRejectedValueOnce(new Error('outcome_unknown'))
    await expect(f.controller.create('parent', task)).rejects.toThrow()
    const request = f.client.createDelegation.mock.calls[0][0]
    await f.store.transaction((s) => {
      s.results['operation'] = {
        request: { method: 'delegation.create', params: request },
        result: { ...child, delegation_key: request.delegation_key },
      }
      s.events.mailbox = [
        {
          kind: 'event',
          node_id: 'node',
          actor: { kind: 'node' },
          at: '2028-01-01T00:00:00Z',
          stream_id: 'mailbox',
          seq: 1,
          type: 'delegation.result',
          data: {
            delegation_id: 'delegation',
            session_id: 'child',
            report_id: 'report',
            text: 'Sample durable result',
          },
        },
        {
          kind: 'event',
          node_id: 'node',
          actor: { kind: 'node' },
          at: '2028-01-01T00:00:00Z',
          stream_id: 'mailbox',
          seq: 2,
          type: 'delegation.terminal',
          data: { delegation_id: 'delegation', session_id: 'child', state: 'completed' },
        },
      ]
      s.cursors.mailbox = 2
    })
    const reopened = new NodeClientStore('sample-delegation', f.factory)
    const resumed = new NodeDelegationController(f.client as unknown as NodeClient, reopened)
    for (let i = 0; i < 2; i++) {
      await resumed.restore()
      const cards = await resumed.cards('parent')
      expect(cards).toHaveLength(1)
      expect(cards[0].state).toBe('completed')
      expect(cards[0].reports).toEqual([{ seq: 1, kind: 'result', text: 'Sample durable result' }])
    }
    expect(f.client.subscribeDelegation).toHaveBeenCalledWith(
      expect.objectContaining({ mailbox_stream_id: 'mailbox' })
    )
    expect(await resumed.cards('other')).toEqual([])
    f.store.close()
    reopened.close()
  })
  it('fences foreign child IDs, uses the observed child revision, and never answers human prompts', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    await f.controller.create('parent', task)
    await expect(f.controller.send('other', 'delegation', 'Follow up')).rejects.toThrow()
    await f.controller.send('parent', 'delegation', 'Follow up')
    expect(f.client.sendDelegation).toHaveBeenCalledWith('delegation', 'Follow up', 17)
    expect((await f.controller.status('parent', 'delegation')).pending_human_prompts).toBe(1)
    await f.controller.revoke('grant')
    await expect(f.controller.cancel('parent', 'delegation')).rejects.toThrow(/grant/i)
    f.store.close()
  })
})
