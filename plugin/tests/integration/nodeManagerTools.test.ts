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
