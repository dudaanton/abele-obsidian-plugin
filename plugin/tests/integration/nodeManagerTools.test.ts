import { afterEach, expect, it, vi } from 'vitest'
import { createNodeManagerTools } from '@/ai/tools/NodeManagerTools'
import { NodeService } from '@/node/NodeService'
import type { ChatSession } from '@/ai/ChatSession'
vi.mock('@/node/NodeService', () => ({ NodeService: { getInstance: vi.fn() } }))
afterEach(() => vi.restoreAllMocks())
it('routes only fixed manager APIs, binding runs to the executing parent and keeping prompt answers out of tools', async () => {
  const mutate = vi.fn(async () => ({ run_id: 'sample-run', state: 'pending_approval' }))
  const status = vi.fn(async () => ({ run_id: 'sample-run', state: 'exited', exit_code: 0 }))
  const refresh = vi.fn(async () => {})
  const connection = {
    connect: async () => {},
    manager: { mutate, status },
    refreshDelegations: refresh,
  }
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-alias', expectedNodeId: 'sample-node' }] },
    connection: () => connection,
  } as never)
  const tools = createNodeManagerTools({
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
    operation_id: 'sample-operation',
    project_id: 'sample-project',
    argv: ['npm', 'test'],
  })
  expect(mutate).toHaveBeenCalledWith(
    'sample-parent',
    'command.v1.run',
    { session_id: 'sample-session', project_id: 'sample-project', argv: ['npm', 'test'] },
    'sample-operation'
  )
  await tools[1].execute('sample-status', { ...base, run_id: 'sample-run' })
  expect(status).toHaveBeenCalledWith('sample-parent', 'sample-session', 'sample-run')
  await tools[3].execute('sample-integrate', {
    ...base,
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
