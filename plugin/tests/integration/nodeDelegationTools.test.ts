import { afterEach, expect, it, vi } from 'vitest'
import { createNodeDelegationTools } from '@/ai/tools/NodeDelegationTools'
import { NodeService } from '@/node/NodeService'
import { NodeDelegationController } from '@/node/NodeDelegationController'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'
import type { ChatSession } from '@/ai/ChatSession'
import type { NodeClient } from '@abele/node-client'
afterEach(() => vi.restoreAllMocks())
it('offers only bounded controller tools; never publishes grant IDs, credentials or owner APIs', async () => {
  const store = new NodeClientStore('tools', new IDBFactory())
  const grant = {
    grant_id: 'private-controller-reference',
    parent_id: 'parent',
    installation_id: 'installation',
    approved_by: 'installation',
    project_ids: ['project'],
    providers: ['pi'],
    actions: ['create', 'send', 'status', 'read', 'cancel'],
    allow_fake: false,
    revoked: false,
    created_at: '2028-01-01T00:00:00Z',
  }
  const client = {
    connected: true,
    listProjects: async () => [],
    describe: async () => ({ providers: [{ provider: 'pi', available: true }] }),
    approveDelegationGrant: vi.fn(async () => grant),
    createDelegation: vi.fn(async (request) => ({
      ...request,
      node_id: 'node',
      session_id: 'child',
      delegation_id: 'delegation',
      parent_id: 'parent',
      mailbox_stream_id: 'mailbox',
      workspace_id: null,
      job_id: null,
      state: 'running',
      created_at: '2028-01-01T00:00:00Z',
    })),
    subscribeDelegation: vi.fn(async () => {}),
  }
  const controller = new NodeDelegationController(client as unknown as NodeClient, store)
  await controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
  const service = {
    nodes: { value: [{ id: 'registration', label: 'Sample node' }] },
    connection: () => ({
      connect: async () => {},
      refreshDelegations: async () => {},
      delegation: controller,
    }),
    registry: {
      token: () => {
        throw new Error('Credentials must never be requested')
      },
    },
  }
  vi.spyOn(NodeService, 'getInstance').mockReturnValue(service as never)
  const tools = createNodeDelegationTools({
    id: 'transient-tab',
    ensureDelegationParentId: async () => 'parent',
  } as ChatSession)
  expect(tools.map((t) => t.name)).toEqual([
    'node_delegations',
    'node_delegate',
    'node_delegation_send',
    'node_delegation_status',
    'node_delegation_cancel',
  ])
  const destinations = await tools[0].execute('list', {}, new AbortController().signal)
  expect(JSON.stringify(destinations)).not.toContain('private-controller-reference')
  const args = {
    node: 'registration',
    task_key: 'task',
    project_id: 'project',
    provider: 'pi',
    title: 'Sample task',
    text: 'Review the parser',
  }
  const result = await tools[1].execute('create', args, new AbortController().signal)
  expect(JSON.stringify(result)).not.toContain('private-controller-reference')
  expect(JSON.stringify(result)).toContain('child')
  await expect(
    tools[1].execute(
      'hostile',
      { ...args, grant_id: 'another-grant' },
      new AbortController().signal
    )
  ).rejects.toThrow()
  expect(client.createDelegation).toHaveBeenCalledTimes(1)
  expect(client.approveDelegationGrant).toHaveBeenCalledTimes(1)
  const unbound = createNodeDelegationTools()
  await expect(unbound[0].execute('script', {}, new AbortController().signal)).rejects.toThrow(
    /parent chat/
  )
  store.close()
})
