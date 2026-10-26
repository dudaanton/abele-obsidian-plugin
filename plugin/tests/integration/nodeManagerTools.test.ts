// Folder execution levels replace the former separate action switches.
import { ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createNodeManagerTools } from '@/ai/tools/NodeManagerTools'
import { NodeService } from '@/node/NodeService'
import { nodeMutationKey } from '@/ai/tools/node/mutations'
import type { ChatSession } from '@/ai/ChatSession'
vi.mock('@/node/NodeService', () => ({ NodeService: { getInstance: vi.fn() } }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('runs a command in the sole granted plain folder without widening workspace scope', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const command = vi.fn(async (_parent: string, _params: Record<string, unknown>) => ({
    run_id: 'sample-run',
    session_id: 'sample-context',
    state: 'pending_approval',
  }))
  const status = vi.fn(async () => ({
    run_id: 'sample-run',
    state: Date.now() < 30_000 ? 'pending_approval' : Date.now() < 90_000 ? 'running' : 'exited',
    exit_code: Date.now() < 90_000 ? null : 7,
    stdout: '/sample/plain',
  }))
  const workspace = {
    workspace_id: 'sample-folder',
    project_id: 'sample-project',
    kind: 'root',
    state: 'ready',
  }
  const client = {
    describe: async () => ({
      capabilities: { capabilities: { command_context_v1: { status: 'supported' } } },
    }),
    getWorkspace: vi.fn(async () => workspace),
    getProject: async () => ({ project_id: 'sample-project', repository_path: null }),
    repository: {
      worktrees: vi.fn(async () => {
        throw new Error('not a repository')
      }),
    },
  }
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-node' }] },
    connection: () => ({
      connect: async () => {},
      client,
      manager: { command, status, targetFor: async () => ({ project_id: 'sample-project' }) },
      refreshDelegations: async () => {},
    }),
  } as never)
  const owner = {
    overrides: ref({
      nodeScope: [
        {
          kind: 'target',
          node_id: 'sample-node',
          project_id: 'sample-project',
          target: { kind: 'workspace', workspace_id: 'sample-folder' },
          access: 'run',
        },
      ],
    }),
    permissionMode: ref('allow-all'),
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'sample-parent',
  } as unknown as ChatSession
  const tool = createNodeManagerTools(owner)[0]
  const args = {
    node: 'sample-node',
    argv: ['pwd'],
    operation_id: 'sample-operation',
    justification: 'Check the sample folder.',
  }
  let settled = false
  const pending = tool.execute('sample-call', args).then((result) => {
    settled = true
    return result
  })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(30_000)
  const completed = await pending
  expect(JSON.parse(completed.content[0].text)).toMatchObject({
    state: 'exited',
    stdout: '/sample/plain',
    exit_code: 7,
  })
  expect(command.mock.calls[0][1]).toEqual({ project_id: 'sample-project', argv: ['pwd'] })
  expect(client.repository.worktrees).not.toHaveBeenCalled()
  const result = await createNodeManagerTools(owner)[1].execute('sample-status', {
    node: 'sample-node',
    session_id: 'sample-context',
    run_id: 'sample-run',
  })
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    state: 'exited',
    stdout: '/sample/plain',
  })
  workspace.state = 'missing'
  await expect(
    tool.execute('sample-missing', { ...args, project_id: 'sample-project' })
  ).rejects.toThrow(/node access|node chips/i)
  expect(command).toHaveBeenCalledTimes(1)
  owner.overrides.value.nodeScope!.push({
    kind: 'project',
    node_id: 'sample-node',
    project_id: 'sample-project',
    access: 'run',
  })
  client.getWorkspace.mockRejectedValueOnce(new Error('missing stale workspace'))
  await tool.execute('sample-project-grant', { ...args, project_id: 'sample-project' })
  expect(command).toHaveBeenCalledTimes(2)
})
it.each(['node_command_run', 'node_git_integrate'])(
  'scopes model aliases to the chat, tool and exact intended action while preserving retries for %s',
  async (name) => {
    const context = vi.fn(async () => ({
      session_id: 'sample-session',
      run_id: 'sample-run',
      state: 'exited',
    }))
    vi.spyOn(NodeService, 'getInstance').mockReturnValue({
      nodes: { value: [{ id: 'sample-node' }] },
      connection: () => ({
        connect: async () => {},
        client: {
          describe: async () => ({
            capabilities: {
              capabilities: {
                delegation_without_grant: { status: 'supported' },
                command_context_v1: { status: 'supported' },
                integration_context_v1: { status: 'supported' },
              },
            },
          }),
        },
        manager: { command: context, integration: context },
        refreshDelegations: async () => {},
      }),
    } as never)
    const tools = (parent: string) =>
      createNodeManagerTools({
        overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'run' }] }),
        getToolMode: () => 'auto',
        ensureDelegationParentId: async () => parent,
      } as ChatSession)
    const args = {
      node: 'sample-node',
      project_id: 'sample-project',
      session_id: 'sample-session',
      ...(name === 'node_command_run'
        ? { argv: ['pwd'] }
        : {
            worktree_id: 'sample-target',
            source_worktree_id: 'sample-source',
            source_branch: 'work/sample',
            target_branch: 'main',
            expected_source_head: 'a'.repeat(40),
            expected_target_head: 'b'.repeat(40),
          }),
      justification: 'Show the sample folder.',
      operation_id: 'save',
    }
    const run = (parent: string, call: string, params = args) =>
      tools(parent)
        .find((t) => t.name === name)!
        .execute(call, params)
    await run('sample-chat-a', 'call-one')
    await run('sample-chat-a', 'retry-call')
    await run('sample-chat-b', 'call-one')
    await run('sample-chat-a', 'call-two', {
      ...args,
      ...(name === 'node_command_run' ? { argv: ['ls'] } : { source_branch: 'work/other' }),
    })
    const ids = context.mock.calls.map((call) => (call as unknown[])[2])
    expect(ids[0]).toBe(ids[1])
    expect(new Set([ids[0], ids[2], ids[3]]).size).toBe(3)
    const params = (context.mock.calls[0] as unknown[])[1]
    expect(ids[0]).toBe(nodeMutationKey('sample-chat-a', name, 'save', params))
    expect(ids[0]).not.toBe(
      nodeMutationKey(
        'sample-chat-a',
        name === 'node_command_run' ? 'node_git_integrate' : 'node_command_run',
        'save',
        params
      )
    )
  }
)
it.each(['confirm-all', 'allow-all'] as const)(
  'uses the advertised integration context without a provider session in owner mode %s',
  async (mode) => {
    const mutate = vi.fn(async () => ({ run_id: 'sample-run', state: 'pending_approval' }))
    const integration = vi.fn(async () => ({ run_id: 'sample-run', state: 'running' }))
    vi.spyOn(NodeService, 'getInstance').mockReturnValue({
      nodes: { value: [{ id: 'sample-node' }] },
      connection: () => ({
        connect: async () => {},
        refreshDelegations: async () => {},
        client: {
          describe: async () => ({
            capabilities: {
              capabilities: {
                delegation_without_grant: { status: 'supported' },
                integration_context_v1: { status: 'supported' },
              },
            },
          }),
        },
        manager: { mutate, integration },
      }),
    } as never)
    const owner = {
      overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'run' }] }),
      permissionMode: ref(mode),
      getToolMode: () => 'auto',
      ensureDelegationParentId: async () => 'sample-parent',
    } as unknown as ChatSession
    await createNodeManagerTools(owner)
      .find((tool) => tool.name === 'node_git_integrate')!
      .execute('sample-call', {
        node: 'sample-node',
        operation_id: 'sample-operation',
        justification: 'Integrate tested changes.',
        worktree_id: 'sample-target',
        source_worktree_id: 'sample-source',
        target_branch: 'main',
        source_branch: 'work/sample',
        expected_target_head: 'a'.repeat(40),
        expected_source_head: 'b'.repeat(40),
      })
    expect(mutate).not.toHaveBeenCalled()
    expect(integration).toHaveBeenCalledWith(
      'sample-parent',
      expect.objectContaining({
        worktree_id: 'sample-target',
        source_worktree_id: 'sample-source',
      }),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      'sample-operation',
      mode === 'allow-all' ? 'bypass' : 'ask',
      'Integrate tested changes.',
      expect.any(Function)
    )
  }
)
it.each(['confirm-all', 'allow-all'] as const)(
  'uses one legacy integration approval in owner mode %s',
  async (mode) => {
    const mutate = vi.fn(async () => ({ run_id: 'sample-run', state: 'pending_approval' }))
    vi.spyOn(NodeService, 'getInstance').mockReturnValue({
      nodes: { value: [{ id: 'sample-node' }] },
      connection: () => ({
        connect: async () => {},
        refreshDelegations: async () => {},
        client: {
          describe: async () => ({
            capabilities: { capabilities: { delegation_without_grant: { status: 'supported' } } },
          }),
        },
        manager: { mutate },
      }),
    } as never)
    const chat = {
      overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'run' }] }),
      permissionMode: ref(mode),
      getToolMode: () => 'auto',
      ensureDelegationParentId: async () => 'sample-parent',
    } as unknown as ChatSession
    await createNodeManagerTools(chat)
      .find((t) => t.name === 'node_git_integrate')!
      .execute('sample-call', {
        node: 'sample-node',
        session_id: 'sample-session',
        operation_id: 'sample-operation',
        justification: 'Integrate tested changes.',
        worktree_id: 'sample-target',
        source_worktree_id: 'sample-source',
        target_branch: 'main',
        source_branch: 'work/sample',
        expected_target_head: 'a'.repeat(40),
        expected_source_head: 'b'.repeat(40),
      })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][1]).toBe('git.v1.integrate')
    expect(mutate.mock.calls[0][2]).not.toHaveProperty('permission_mode')
  }
)
it('retains the inferred scoped folder in an old-node refusal', async () => {
  const refuse = vi.fn(async () => {
    throw new Error('Update the node to 0.4.47')
  })
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-node' }] },
    connection: () => ({
      connect: async () => {},
      refreshDelegations: async () => {},
      manager: { refuse },
      client: { describe: async () => ({}) },
    }),
  } as never)
  const chat = {
    overrides: ref({
      nodeScope: [
        {
          kind: 'target',
          node_id: 'sample-node',
          project_id: 'sample-project',
          target: { kind: 'worktree', worktree_id: 'sample-tree' },
          access: 'run',
        },
      ],
    }),
    getToolMode: () => 'ask',
    ensureDelegationParentId: async () => 'sample-parent',
  } as unknown as ChatSession
  await expect(
    createNodeManagerTools(chat)[0].execute('sample-call', {
      node: 'sample-node',
      argv: ['node', '--version'],
      operation_id: 'sample-operation',
      justification: 'Check the runtime.',
    })
  ).rejects.toThrow(/0.4.47/)
  expect(refuse.mock.calls[0][1]).toMatchObject({ worktree_id: 'sample-tree' })
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
      refreshDelegations: async () => {},
      client: { describe: async () => ({ capabilities: { capabilities: {} } }) },
      manager: {
        mutate,
        status,
        targetFor: async () => undefined,
        refuse: async () => {
          throw new Error('Update the node to 0.4.47')
        },
      },
    }),
  } as never)
  const tools = createNodeManagerTools({
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'run' }] }),
    getToolMode: () => 'auto',
    ensureDelegationParentId: async () => 'sample-parent',
  } as ChatSession)
  for (const tool of tools.filter((t) =>
    ['node_command_run', 'node_git_integrate'].includes(t.name)
  ))
    await expect(
      tool.execute('sample-call', {
        node: 'sample-node',
        session_id: 'sample-session',
        justification: 'Check the sample project.',
        operation_id: 'sample-operation',
        run_id: 'sample-run',
      })
    ).rejects.toThrow(
      tool.name === 'node_command_run'
        ? /0.4.47/
        : /This node needs an update to take tasks from chats/
    )
  expect(mutate).not.toHaveBeenCalled()
  expect(status).not.toHaveBeenCalled()
})

it.each(['confirm-all', 'allow-edit', 'allow-all'] as const)(
  'uses the effective owner mode %s even when a model supplies bypass',
  async (mode) => {
    const command = vi.fn(async () => ({
      session_id: 'sample-session',
      run_id: 'sample-run',
      state: 'pending_approval',
    }))
    vi.spyOn(NodeService, 'getInstance').mockReturnValue({
      nodes: { value: [{ id: 'sample-node' }] },
      connection: () => ({
        connect: async () => {},
        refreshDelegations: async () => {},
        manager: {
          command,
          status: async () => ({
            session_id: 'sample-session',
            run_id: 'sample-run',
            state: 'exited',
            exit_code: 0,
          }),
        },
        client: {
          describe: async () => ({
            capabilities: { capabilities: { command_context_v1: { status: 'supported' } } },
          }),
          repository: {
            worktrees: async () => ({
              entries: [{ worktree_id: 'sample-tree', workspace_id: 'sample-workspace' }],
            }),
          },
        },
      }),
    } as never)
    const chat = {
      overrides: ref({
        nodeScope: [
          {
            kind: 'target',
            node_id: 'sample-node',
            project_id: 'sample-project',
            target: { kind: 'worktree', worktree_id: 'sample-tree' },
            access: 'run',
          },
        ],
      }),
      permissionMode: ref(mode),
      getToolMode: () => 'auto',
      ensureDelegationParentId: async () => 'sample-parent',
    } as unknown as ChatSession
    await createNodeManagerTools(chat)[0].execute('sample-call', {
      node: 'sample-node',
      worktree_id: 'sample-tree',
      command: 'node --version',
      operation_id: 'sample-operation',
      justification: 'Check the runtime.',
      permission_mode: 'bypass',
      session_id: 'sample-provider-session',
    })
    expect(command.mock.calls[0][4]).toBe(mode === 'allow-all' ? 'bypass' : 'ask')
  }
)
it('refuses a command for a project outside the chat node chips', async () => {
  const mutate = vi.fn()
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-alias', expectedNodeId: 'sample-node' }] },
    connection: () => ({
      connect: async () => {},
      manager: { mutate },
      client: {
        describe: async () => ({
          capabilities: {
            capabilities: {
              delegation_without_grant: { status: 'supported' },
              command_context_v1: { status: 'supported' },
            },
          },
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
        { kind: 'project', node_id: 'sample-node', project_id: 'sample-project', access: 'run' },
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
  const command = vi.fn(async () => ({
    session_id: 'sample-session',
    run_id: 'sample-run',
    state: 'pending_approval',
  }))
  const status = vi.fn(async () => ({ run_id: 'sample-run', state: 'exited', exit_code: 0 }))
  const refresh = vi.fn(async () => {})
  const connection = {
    client: {
      describe: async () => ({
        capabilities: {
          capabilities: {
            delegation_without_grant: { status: 'supported' },
            command_context_v1: { status: 'supported' },
          },
        },
      }),
    },
    connect: async () => {},
    manager: {
      command,
      targetFor: async () => undefined,
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
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'run' }] }),
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
  expect(command).toHaveBeenCalledWith(
    'sample-parent',
    { session_id: 'sample-session', project_id: 'sample-project', argv: ['npm', 'test'] },
    nodeMutationKey('sample-parent', 'node_command_run', 'sample-operation', {
      session_id: 'sample-session',
      project_id: 'sample-project',
      argv: ['npm', 'test'],
    }),
    'sample-operation',
    'ask',
    'Check the sample project.',
    expect.any(Function)
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
  expect(mutate.mock.calls[0][1]).toBe('git.v1.integrate')
  expect(refresh).toHaveBeenCalledTimes(4)
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
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'run' }] }),
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
