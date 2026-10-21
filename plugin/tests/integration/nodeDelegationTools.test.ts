import { ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createNodeDelegationTools } from '@/ai/tools/NodeDelegationTools'
import { NodeService } from '@/node/NodeService'
import { NodeDelegationController } from '@/node/NodeDelegationController'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'
import type { ChatSession } from '@/ai/ChatSession'
import type { NodeClient } from '@abele/node-client'
vi.mock('@/node/NodeService', () => ({ NodeService: { getInstance: vi.fn() } }))
afterEach(() => vi.restoreAllMocks())
it('refuses disabled tools before contacting a node, even with a read chip', async () => {
  const owner = {
    getToolMode: () => 'off',
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'read' }] }),
  } as unknown as ChatSession
  for (const tool of createNodeDelegationTools(owner))
    await expect(tool.execute('sample-call', { node: 'sample-node' })).rejects.toThrow(/tool.*off/i)
})
it('uses the exact registration for both the scope check and the connection', async () => {
  const create = vi.fn(async () => ({ delegation_id: 'sample-child' }))
  const connect = vi.fn(async () => {})
  const connection = vi.fn(() => ({
    connect,
    client: {
      describe: async () => ({
        capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
      }),
    },
    delegation: { create },
    refreshDelegations: async () => {},
  }))
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: {
      value: [
        { id: 'other-alias', expectedNodeId: 'sample-alias' },
        { id: 'sample-alias', expectedNodeId: 'sample-node' },
      ],
    },
    connection,
  } as never)
  const owner = {
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'sample-parent',
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'read' }] }),
  } as unknown as ChatSession
  await createNodeDelegationTools(owner)[1].execute('sample-call', {
    node: 'sample-alias',
    task_key: 'sample-task',
    provider: 'pi',
    title: 'Sample task',
    text: 'Work',
  })
  expect(connection).toHaveBeenCalledWith('sample-alias')
  expect(create).toHaveBeenCalledOnce()
})
it('uses project scope for every child action and rechecks it after connecting', async () => {
  const owner = {
    overrides: ref({
      nodeScope: [
        { kind: 'project', node_id: 'sample-node', project_id: 'sample-project', access: 'read' },
      ],
    }),
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'sample-parent',
  } as ChatSession
  const delegation = {
    cards: async () => [{ delegationId: 'sample-child', projectId: 'other-project' }],
    create: vi.fn(),
    send: vi.fn(),
    status: vi.fn(),
    cancel: vi.fn(),
  }
  const connect = vi.fn(async () => {})
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-alias', expectedNodeId: 'sample-node' }] },
    connection: () => ({
      client: {
        describe: async () => ({
          capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
        }),
      },
      connect,
      delegation,
      refreshDelegations: async () => {},
    }),
  } as never)
  const tools = createNodeDelegationTools(owner)
  const args = {
    node: 'sample-alias',
    task_key: 'sample-task',
    project_id: 'other-project',
    provider: 'pi',
    title: 'Task',
    text: 'Work',
  }
  await expect(tools[1].execute('create', args)).rejects.toThrow(/node chips/i)
  for (const tool of tools.slice(2)) {
    await expect(
      tool.execute('child', {
        node: 'sample-alias',
        delegation_id: 'sample-child',
        ...(tool.name.endsWith('_send') ? { text: 'Continue' } : {}),
      })
    ).rejects.toThrow(/node chips/i)
  }
  expect(connect).not.toHaveBeenCalled()
  connect.mockImplementationOnce(async () => {
    owner.overrides.value.nodeScope = []
  })
  await expect(
    tools[1].execute('create', { ...args, project_id: 'sample-project' })
  ).rejects.toThrow(/node chips/i)
  for (const method of ['create', 'send', 'status', 'cancel'] as const)
    expect(delegation[method]).not.toHaveBeenCalled()
})
it('lists stable IDs and resolves them for all child operations', async () => {
  const delegation = {
    destinations: vi.fn(async () => [
      { providers: ['codex'], project_ids: ['project'], projects: [{ project_id: 'project' }] },
    ]),
    cards: vi.fn(async () => [{ delegationId: 'child', projectId: 'project' }]),
    create: vi.fn(async () => ({ delegation_id: 'child' })),
    send: vi.fn(async () => ({})),
    status: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({})),
  }
  const connection = {
    client: {
      describe: async () => ({
        capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
      }),
    },
    connect: async () => {},
    refreshDelegations: async () => {},
    delegation,
  }
  const service = {
    nodes: { value: [{ id: 'alias', expectedNodeId: 'stable', label: 'Sample' }] },
    connection: vi.fn((id: string) => {
      if (id !== 'alias') throw new Error('Unknown registration')
      return connection
    }),
  }
  vi.spyOn(NodeService, 'getInstance').mockReturnValue(service as never)
  const tools = createNodeDelegationTools({
    overrides: ref({
      nodeScope: [
        { kind: 'node', node_id: 'stable', access: 'read' },
        { kind: 'node', node_id: 'registration', access: 'edit' },
      ],
    }),
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'parent',
  } as ChatSession)
  const listed = await tools[0].execute('list', {})
  expect(JSON.stringify(listed)).toContain('stable')
  expect(JSON.stringify(listed)).not.toContain('alias')
  expect(tools[1].parameters.properties?.provider).toMatchObject({
    enum: expect.arrayContaining(['codex']),
  })
  for (const node of ['stable', 'alias']) {
    await tools[1].execute('create', {
      node,
      task_key: 'key',
      project_id: 'project',
      provider: 'codex',
      title: 'Task',
      text: 'Work',
    })
    for (const tool of tools.slice(2))
      await tool.execute('child', {
        node,
        delegation_id: 'child',
        ...(tool.name.endsWith('_send') ? { text: 'Continue' } : {}),
      })
  }
  for (const action of ['create', 'send', 'status', 'cancel'] as const)
    expect(delegation[action]).toHaveBeenCalledTimes(action === 'status' ? 3 : 2)
  service.nodes.value.push({ id: 'second', expectedNodeId: 'stable', label: 'Other installation' })
  await expect(
    tools[3].execute('ambiguous', { node: 'stable', delegation_id: 'child' })
  ).rejects.toThrow(/installation/i)
})
it('never creates after Stop while connecting, and cancels a child accepted concurrently with Stop', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const created = vi.fn(async () => ({ delegation_id: 'child' }))
  const cancel = vi.fn(async () => {})
  const service = {
    nodes: { value: [{ id: 'node' }] },
    connection: () => ({
      client: {
        describe: async () => ({
          capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
        }),
      },
      connect: () => gate,
      delegation: { create: created, cancel },
      refreshDelegations: async () => {},
    }),
  }
  vi.spyOn(NodeService, 'getInstance').mockReturnValue(service as never)
  const tools = createNodeDelegationTools({
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'node', access: 'edit' }] }),
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'parent',
  } as ChatSession)
  const signal = new AbortController()
  const pending = tools[1].execute(
    'create',
    { node: 'node', task_key: 'key', provider: 'pi', title: 'Task', text: 'Work' },
    signal.signal
  )
  signal.abort()
  release()
  await expect(pending).rejects.toThrow(/cancelled/)
  expect(created).not.toHaveBeenCalled()
  const racing = new AbortController()
  created.mockImplementationOnce(async () => {
    racing.abort()
    return { delegation_id: 'child' }
  })
  await expect(
    tools[1].execute(
      'create',
      { node: 'node', task_key: 'key', provider: 'pi', title: 'Task', text: 'Work' },
      racing.signal
    )
  ).rejects.toThrow(/cancelled/)
  expect(cancel).toHaveBeenCalledWith('parent', 'child')
})

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
    describe: async () => ({
      capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
      providers: [{ provider: 'pi', available: true }],
    }),
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

  const service = {
    nodes: { value: [{ id: 'registration', label: 'Sample node' }] },
    connection: () => ({
      client: {
        describe: async () => ({
          capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
        }),
      },
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
    overrides: ref({
      nodeScope: [
        { kind: 'node', node_id: 'stable', access: 'read' },
        { kind: 'node', node_id: 'registration', access: 'edit' },
      ],
    }),
    getToolMode: () => 'auto',
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
  expect(client.approveDelegationGrant).not.toHaveBeenCalled()
  const unbound = createNodeDelegationTools()
  await expect(unbound[0].execute('script', {}, new AbortController().signal)).rejects.toThrow(
    /parent chat/
  )
  store.close()
})
