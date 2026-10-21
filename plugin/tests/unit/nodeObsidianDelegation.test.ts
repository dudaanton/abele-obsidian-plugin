import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { NodeClient } from '@abele/node-client'
import { validateParams } from '@abele/node-protocol'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeDelegationController } from '@/node/NodeDelegationController'

it('retains the trusted inline snapshot across creation retries and rejects model-supplied permissions', async () => {
  const factory = new IDBFactory(),
    store = new NodeClientStore('sample-inline-tools', factory)
  const create = vi.fn(async (request: { delegation_key: string }) => ({
    node_id: 'sample-node',
    session_id: 'sample-child',
    delegation_id: 'sample-delegation',
    delegation_key: request.delegation_key,
    grant_id: 'sample-grant',
    parent_id: 'sample-parent',
    mailbox_stream_id: 'sample-mailbox',
    workspace_id: null,
    job_id: null,
    state: 'running',
    created_at: '2025-01-01T00:00:00.000Z',
  }))
  const client = {
    describe: async () => ({
      capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
      providers: [{ provider: 'claude', available: true }],
    }),
    createDelegation: create,
    subscribeDelegation: async () => {},
  } as unknown as NodeClient
  const snapshot = {
    vault_id: 'sample-vault',
    agent_id: 'sample-agent',
    revision: 'sample-revision',
    tools: [
      {
        name: 'create',
        description: 'Create a file',
        inputSchema: { type: 'object' },
        mode: 'ask' as const,
      },
    ],
  }
  const controller = new NodeDelegationController(client, store)
  controller.obsidianSnapshot = vi.fn(async () => snapshot)
  const task = {
    task_key: 'sample-task',
    provider: 'claude' as const,
    title: 'Sample task',
    text: 'Create a sample note',
  }
  try {
    await expect(
      controller.create('sample-parent', { ...task, obsidian_tools: { tools: [] } } as never)
    ).rejects.toThrow()
    await controller.create('sample-parent', task)
    const first = create.mock.calls[0][0]
    expect(first).toMatchObject({ parent_id: 'sample-parent', obsidian_tools: snapshot })
    expect(validateParams('delegation.create', first)).toMatchObject({ obsidian_tools: snapshot })
    await controller.create('sample-parent', task)
    expect(create.mock.calls[1][0]).toEqual(first)
    expect(controller.obsidianSnapshot).toHaveBeenCalledTimes(1)
    const reopened = new NodeClientStore('sample-inline-tools', factory)
    expect(
      await reopened.read((state) => Object.values(state.delegation!.tasks)[0].request)
    ).toEqual(first)
    reopened.close()
  } finally {
    store.close()
  }
})
