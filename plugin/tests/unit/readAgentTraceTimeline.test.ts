import { expect, it, vi } from 'vitest'
import { NodeScopeLedger } from '@/ai/nodeScope'
import { TraceRpc } from '@/debugger/trace/wire'
import { readAgentTraceTimeline } from '@/testing/readAgentTraceTimeline'
import { nodeAgentHost } from '@/ai/tools/node/owner'
import { activeTraceContext } from '@/debugger/trace/agentContext'
import { createTraceTools } from '@/ai/tools/TraceTools'

vi.mock('@/ai/tools/node/owner', () => ({ nodeAgentHost: vi.fn() }))
vi.mock('@/debugger/trace/agentContext', () => ({ activeTraceContext: vi.fn() }))
vi.mock('@/ai/ScopeResolver', () => ({ ScopeResolver: { getInstance: () => ({}) } }))

it('still rejects the old sessionless agent-tool invocation', async () => {
  const request = vi.fn()
  const context = {
    registrationId: 'sample-registration',
    projectId: 'sample-project',
    rpc: new TraceRpc(request),
    runs: async () => [],
    addPoint: async () => {},
    writeNote: async () => '',
  }
  await expect(
    createTraceTools(() => context)
      .find((tool) => tool.name === 'trace_timeline')
      .execute('sample-analysis', { run: 'sample-run' })
  ).rejects.toThrow('An executing chat')
  expect(request).not.toHaveBeenCalled()
})

it.each([false, true])(
  'runs the formatter with scoped read access and revokes it afterward (failure: %s)',
  async (failure) => {
    const ledger = new NodeScopeLedger()
    const guard = vi.spyOn(ledger, 'guardNode')
    const request = vi.fn(async () => {
      if (failure) throw new Error('sample read failure')
      expect(guard.mock.calls[0][0].overrides.value.nodeScope).toEqual([
        { kind: 'project', node_id: 'sample-node', project_id: 'sample-project', access: 'read' },
      ])
      return {
        steps: [],
        marks: [],
        points: [],
        folder: '/sample/runs',
        run: {
          id: 'sample-run',
          name: 'Sample run',
          debug_session_id: 'sample-debug',
          started_at: '2025-01-01T00:00:00.000Z',
          state: 'done',
          steps: 0,
          bytes: 0,
        },
      }
    })
    vi.mocked(nodeAgentHost).mockResolvedValue({
      ledger,
      nodes: () => [],
      nodeId: () => 'sample-node',
      connection: () => ({
        client: { connected: true },
        principal: () => 'sample-principal',
        authorizationGeneration: 0,
      }),
    } as never)
    vi.mocked(activeTraceContext).mockReturnValue({
      registrationId: 'sample-registration',
      projectId: 'sample-project',
      rpc: new TraceRpc(request),
      runs: async () => [],
      addPoint: async () => {},
      writeNote: async () => '',
    })
    if (failure)
      await expect(readAgentTraceTimeline('sample-run')).rejects.toThrow('sample read failure')
    else expect((await readAgentTraceTimeline('sample-run')).content).toHaveLength(1)
    expect(request).toHaveBeenCalledWith(
      'trace.v1.run',
      expect.objectContaining({ project_id: 'sample-project', run_id: 'sample-run' })
    )
    const session = guard.mock.calls[0][0]
    expect(session.overrides.value.nodeScope).toEqual([])
    expect(ledger.approvedNode(session, 'sample-node', 'sample-principal')).toBe(false)
  }
)
