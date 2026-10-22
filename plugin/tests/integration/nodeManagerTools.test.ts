import { ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createNodeManagerTools } from '@/ai/tools/NodeManagerTools'
import { NodeService } from '@/node/NodeService'
import { nodeMutationKey } from '@/ai/tools/node/mutations'
import type { ChatSession } from '@/ai/ChatSession'
vi.mock('@/node/NodeService', () => ({ NodeService: { getInstance: vi.fn() } }))
afterEach(() => vi.restoreAllMocks())
it('scopes model aliases to the chat, tool and exact intended action while preserving retries', async () => {
  const mutate = vi.fn(async () => ({ run_id: 'sample-run', state: 'running' }))
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-node' }] },
    connection: () => ({
      connect: async () => {},
      client: {
        describe: async () => ({
          capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
        }),
      },
      manager: { mutate },
      refreshDelegations: async () => {},
    }),
  } as never)
  const tools = (parent: string) =>
    createNodeManagerTools({
      overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'edit' }] }),
      getToolMode: () => 'auto',
      ensureDelegationParentId: async () => parent,
    } as ChatSession)
  const args = {
    node: 'sample-node',
    project_id: 'sample-project',
    session_id: 'sample-session',
    argv: ['pwd'],
    justification: 'Show the sample folder.',
    operation_id: 'save',
  }
  await tools('sample-chat-a')[0].execute('call-one', args)
  await tools('sample-chat-a')[0].execute('retry-call', args)
  await tools('sample-chat-b')[0].execute('call-one', args)
  await tools('sample-chat-a')[0].execute('call-two', { ...args, argv: ['ls'] })
  const ids = mutate.mock.calls.map((call) => (call as unknown[])[3])
  expect(ids[0]).toBe(ids[1])
  expect(new Set([ids[0], ids[2], ids[3]]).size).toBe(3)
})
it('requires justification in both command-like tool schemas', async () => {
  const owner = {
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'sample-parent',
  } as unknown as ChatSession
  for (const tool of createNodeManagerTools(owner).filter((tool) =>
    ['node_command_run', 'node_git_integrate'].includes(tool.name)
  )) {
    expect(tool.parameters.required).toContain('justification')
    await expect(tool.execute('sample-call', { node: 'sample-node' })).rejects.toThrow()
  }
})
it('refuses disabled manager tools before contacting a node', async () => {
  const owner = { getToolMode: () => 'off' } as unknown as ChatSession
  for (const tool of createNodeManagerTools(owner))
    await expect(tool.execute('sample-call', {})).rejects.toThrow(/tool.*off/i)
})
it('refuses every manager operation on an older node without sending a mutation', async () => {
  const mutate = vi.fn(),
    status = vi.fn()
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-node' }] },
    connection: () => ({
      connect: async () => {},
      client: { describe: async () => ({ capabilities: { capabilities: {} } }) },
      manager: { mutate, status },
    }),
  } as never)
  const tools = createNodeManagerTools({
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'read' }] }),
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'sample-parent',
  } as ChatSession)
  for (const tool of tools)
    await expect(
      tool.execute('sample-call', {
        node: 'sample-node',
        session_id: 'sample-session',
        justification: 'Check the sample project.',
        operation_id: 'sample-operation',
        run_id: 'sample-run',
      })
    ).rejects.toThrow('This node needs an update to take tasks from chats')
  expect(mutate).not.toHaveBeenCalled()
  expect(status).not.toHaveBeenCalled()
})
it('refuses a command for a project outside the chat node chips', async () => {
  const mutate = vi.fn()
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-alias', expectedNodeId: 'sample-node' }] },
    connection: () => ({
      connect: async () => {},
      manager: { mutate },
      client: {
        describe: async () => ({
          capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
        }),
        getSession: async () => ({ workspace_id: 'sample-workspace' }),
        getWorkspace: async () => ({ project_id: 'sample-project' }),
        nodePath: {
          sessionWorktreeGet: async () => ({
            project_id: 'sample-project',
            target: { kind: 'workspace', workspace_id: 'sample-workspace' },
          }),
        },
      },
    }),
  } as never)
  const tool = createNodeManagerTools({
    overrides: ref({
      nodeScope: [
        { kind: 'project', node_id: 'sample-node', project_id: 'sample-project', access: 'read' },
      ],
    }),
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'sample-parent',
  } as ChatSession)[0]
  await expect(
    tool.execute('sample-call', {
      node: 'sample-alias',
      session_id: 'sample-session',
      project_id: 'other-project',
      argv: ['pwd'],
      justification: 'Check the sample project.',
      operation_id: 'sample-operation',
    })
  ).rejects.toThrow(/node chips/i)
  expect(mutate).not.toHaveBeenCalled()
})
it('routes only fixed manager APIs, binding runs to the executing parent and keeping prompt answers out of tools', async () => {
  const mutate = vi.fn(async () => ({ run_id: 'sample-run', state: 'pending_approval' }))
  const status = vi.fn(async () => ({ run_id: 'sample-run', state: 'exited', exit_code: 0 }))
  const refresh = vi.fn(async () => {})
  const connection = {
    client: {
      describe: async () => ({
        capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
      }),
    },
    connect: async () => {},
    manager: {
      mutate,
      status,
      cleanupFor: vi.fn(async () => ({
        worktree_id: 'sample-source',
        owner_approval_required: true,
      })),
    },
    refreshDelegations: refresh,
  }
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-alias', expectedNodeId: 'sample-node' }] },
    connection: () => connection,
  } as never)
  const tools = createNodeManagerTools({
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'read' }] }),
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'sample-parent',
  } as ChatSession)
  expect(tools.map((tool) => tool.name)).toEqual([
    'node_command_run',
    'node_command_status',
    'node_command_cancel',
    'node_git_integrate',
  ])
  const base = { node: 'sample-node', session_id: 'sample-session' }
  await tools[0].execute('sample-call', {
    ...base,
    justification: 'Check the sample project.',
    operation_id: 'sample-operation',
    project_id: 'sample-project',
    argv: ['npm', 'test'],
  })
  expect(mutate).toHaveBeenCalledWith(
    'sample-parent',
    'command.v1.run',
    { session_id: 'sample-session', project_id: 'sample-project', argv: ['npm', 'test'] },
    nodeMutationKey('sample-parent', 'node_command_run', 'sample-operation', {
      session_id: 'sample-session',
      project_id: 'sample-project',
      argv: ['npm', 'test'],
    }),
    'sample-operation',
    'Check the sample project.'
  )
  await tools[1].execute('sample-status', { ...base, run_id: 'sample-run' })
  expect(status).toHaveBeenCalledWith('sample-parent', 'sample-session', 'sample-run')
  await tools[3].execute('sample-integrate', {
    ...base,
    justification: 'Check the sample project.',
    operation_id: 'sample-integration',
    worktree_id: 'sample-target',
    source_worktree_id: 'sample-source',
    target_branch: 'main',
    source_branch: 'work/sample',
    expected_target_head: 'a'.repeat(40),
    expected_source_head: 'b'.repeat(40),
    rebase: true,
  })
  expect(mutate.mock.calls[1][1]).toBe('git.v1.integrate')
  expect(refresh).toHaveBeenCalledTimes(3)
  status.mockResolvedValueOnce({
    run_id: 'sample-run',
    method: 'git.v1.integrate',
    state: 'applied',
  } as never)
  const completed = await tools[1].execute('sample-final-status', { ...base, run_id: 'sample-run' })
  expect(JSON.parse(completed.content[0].text).worktree_cleanup).toMatchObject({
    worktree_id: 'sample-source',
    owner_approval_required: true,
  })
  expect(connection.manager.cleanupFor).toHaveBeenCalledWith('sample-parent', 'sample-run')
})
it('never enqueues execution after the parent stops while connecting', async () => {
  const signal = new AbortController()
  const mutate = vi.fn()
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-node' }] },
    connection: () => ({
      connect: async () => {
        signal.abort()
      },
      manager: { mutate },
    }),
  } as never)
  const tool = createNodeManagerTools({
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'read' }] }),
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'sample-parent',
  } as ChatSession)[0]
  await expect(
    tool.execute(
      'sample-call',
      {
        node: 'sample-node',
        session_id: 'sample-session',
        project_id: 'sample-project',
        command: 'pwd',
        justification: 'Check the sample project.',
        operation_id: 'sample-operation',
      },
      signal.signal
    )
  ).rejects.toThrow('cancelled')
  expect(mutate).not.toHaveBeenCalled()
})

it('sends retained manager operations through the real SDK outbox with the exact envelope ID', async () => {
  const { NodeClient } = await import('@abele/node-client')
  const { NodeClientStore } = await import('@/node/NodeClientStore')
  const { NodeManagerController } = await import('@/node/NodeManagerController')
  const { IDBFactory } = await import('fake-indexeddb')
  const store = new NodeClientStore(crypto.randomUUID(), new IDBFactory())
  const client = new NodeClient(
    {
      url: 'ws://127.0.0.1:7777/channel',
      profile: 'local-token-v1',
      token: 'sample-token',
      expected_node_id: 'sample-node',
    },
    store
  )
  const receipt = {
    run_id: 'sample-run',
    session_id: 'sample-session',
    prompt_id: 'sample-prompt',
    method: 'command.v1.run',
    state: 'pending_approval',
    stdout: '',
    stderr: '',
    stdout_truncated: false,
    stderr_truncated: false,
  }
  const request = vi.fn(async (method: string, _params: unknown, _operation?: string) => {
    if (method === 'node.describe')
      return { capabilities: { capabilities: { command_run_v1: { status: 'supported' } } } }
    if (method === 'command.v1.run') return receipt
    return undefined
  })
  Object.assign(client, { channel: { request } })
  const controller = new NodeManagerController(client, store)
  const params = {
    session_id: 'sample-session',
    project_id: 'sample-project',
    argv: ['npm', 'test'],
    output_bytes: 1024,
  }
  try {
    expect(
      await controller.mutate('sample-parent', 'command.v1.run', params, 'sample-operation')
    ).toEqual(receipt)
    await controller.mutate('sample-parent', 'command.v1.run', params, 'sample-operation')
    expect(request.mock.calls.filter((call) => call[0] === 'command.v1.run')).toEqual([
      ['command.v1.run', params, 'sample-operation'],
    ])
    expect(await client.operationResult('sample-operation')).toMatchObject({
      result: receipt,
      request: { method: 'command.v1.run', params },
    })
    expect(request.mock.calls.some((call) => call[0] === 'prompt.answer')).toBe(false)
  } finally {
    store.close()
  }
})
