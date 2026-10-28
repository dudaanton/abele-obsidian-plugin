import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => {
  const binding = {
    registrationId: 'sample-node',
    conversationId: 'sample-chat',
    sessionId: 'sample-debug',
    controller: { snapshot: { target: { worktree_id: 'sample-tree' } } },
    trace: { projectId: 'sample-project', rpc: {}, savePoint: vi.fn() },
  }
  const folder = {
    registrationId: 'sample-node',
    nodeId: 'sample-node',
    projectId: 'sample-project',
    kind: 'worktree',
    id: 'sample-tree',
  }
  let admitted = false
  return {
    binding,
    folder,
    sourceFor: vi.fn(() => (admitted ? 'sample-source' : undefined)),
    admitFile: vi.fn(async () => {
      admitted = true
      return { message: '' }
    }),
  }
})
vi.mock('@/debugger/DebuggerService', () => ({
  DebuggerService: {
    instance: {
      active: { value: state.binding },
      sourceFor: state.sourceFor,
      folder: () => state.folder,
      admitSessionFile: state.admitFile,
    },
  },
}))
vi.mock('@/debugger/trace/runNote', () => ({ writeRunNote: vi.fn() }))
import { activeTraceContext } from '@/debugger/trace/agentContext'
it('attaches a source before saving a trace point', async () => {
  await activeTraceContext()!.addPoint('src/sample.ts', 105, { take: [], note: 'Inspect sample' })
  expect(state.admitFile).toHaveBeenCalledWith(state.binding, 'src/sample.ts')
  expect(state.binding.trace.savePoint).toHaveBeenCalledWith('sample-source', 105, {
    take: [],
    note: 'Inspect sample',
  })
})

it('rechecks chat permission after source admission before saving the point', async () => {
  state.binding.trace.savePoint.mockClear()
  state.sourceFor.mockReturnValueOnce(undefined)
  let allowed = true
  state.admitFile.mockImplementationOnce(async () => {
    allowed = false
    return { message: '' }
  })
  await expect(
    activeTraceContext()!.addPoint('src/other.ts', 105, { take: [] }, () => {
      if (!allowed) throw new Error('Scope revoked')
    })
  ).rejects.toThrow('Scope revoked')
  expect(state.binding.trace.savePoint).not.toHaveBeenCalled()
})
