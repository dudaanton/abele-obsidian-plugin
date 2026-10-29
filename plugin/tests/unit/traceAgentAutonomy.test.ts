import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => {
  const binding = {
    registrationId: 'sample-node',
    conversationId: 'sample-chat',
    sessionId: 'sample-debug',
    controller: {
      current: true,
      session: { unavailable: false },
      snapshot: { target: { worktree_id: 'sample-tree' } },
      knownBreakpoints: vi.fn(() => [
        { id: 'sample-point', sourceId: 'sample-source', requestedLine: 7 },
      ]),
      mappedSource: vi.fn(),
    },
    trace: {
      projectId: 'sample-project',
      rpc: {},
      points: [{ breakpoint_id: 'sample-point' }],
      savePoint: vi.fn(),
      removePoint: vi.fn(),
      refreshPoints: vi.fn(async () => {}),
    },
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
    active: { value: binding },
    fileBinding: vi.fn(() => binding),
    editPendingPoint: vi.fn(),
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
      active: state.active,
      sourceFor: state.sourceFor,
      folder: () => state.folder,
      admitSessionFile: state.admitFile,
      fileBinding: state.fileBinding,
      editPendingPoint: state.editPendingPoint,
    },
  },
}))
vi.mock('@/debugger/trace/runNote', () => ({ writeRunNote: vi.fn() }))
import { activeTraceContext } from '@/debugger/trace/agentContext'
it('resolves selectors from the captured binding after the viewed session changes', async () => {
  const captured = activeTraceContext()!
  const original = state.active.value
  state.active.value = { ...original, trace: undefined } as never
  try {
    const selected = captured.select!({ file: 'src/sample.ts' })!
    expect(selected.sessionId).toBe(original.sessionId)
    expect(state.fileBinding).toHaveBeenLastCalledWith(state.folder, 'src/sample.ts', {
      session: undefined,
      process: undefined,
    })
    expect(selected.projectId).toBe(original.trace.projectId)
  } finally {
    state.active.value = original
  }
})
it('keeps an agent point pending instead of admitting it to a different process', async () => {
  state.fileBinding.mockReturnValueOnce(undefined as never)
  const before = state.binding.trace.savePoint.mock.calls.length
  const result = await activeTraceContext({ file: 'packages/rates/src/rates.ts' })!.addPoint(
    'packages/rates/src/rates.ts',
    4,
    { take: ['rate'] }
  )
  expect(result).toMatchObject({
    recording: false,
    reason: expect.stringMatching(/process.*pending|pending.*process/),
  })
  expect(state.editPendingPoint).toHaveBeenCalledWith(
    state.folder,
    'packages/rates/src/rates.ts',
    4,
    { record: { take: ['rate'], note: undefined }, condition: undefined }
  )
  expect(state.binding.trace.savePoint.mock.calls.length).toBe(before)
})
it('attaches a source before saving a trace point', async () => {
  await activeTraceContext()!.addPoint('src/sample.ts', 105, { take: [], note: 'Inspect sample' })
  expect(state.admitFile).toHaveBeenCalledWith(state.binding, 'src/sample.ts')
  expect(state.binding.trace.savePoint).toHaveBeenCalledWith('sample-source', 105, {
    take: [],
    note: 'Inspect sample',
  })
})

it('refuses to promise recording after the selected session detached', async () => {
  state.binding.trace.savePoint.mockClear()
  Object.assign(state.binding.controller, { current: false })
  await expect(
    activeTraceContext()!.addPoint('src/sample.ts', 4, { take: ['sample'] })
  ).rejects.toThrow(/detached|ended|active/i)
  expect(state.binding.trace.savePoint).not.toHaveBeenCalled()
  Object.assign(state.binding.controller, { current: true })
})

it('warns when a source is not bound to the selected process', async () => {
  state.binding.controller.knownBreakpoints.mockReturnValueOnce([
    {
      id: 'sample-point',
      sourceId: 'sample-source',
      requestedLine: 4,
      state: 'pending',
      reason: 'Source not loaded',
    },
  ])
  const result = await activeTraceContext()!.addPoint('src/sample.ts', 4, { take: ['sample'] })
  expect(result).toEqual({ recording: false, reason: 'Source not loaded' })
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

it('removes only the point at the requested source line', async () => {
  state.binding.trace.removePoint.mockImplementationOnce(async () => {
    state.binding.trace.points = []
  })
  const guard = vi.fn()
  await activeTraceContext()!.removePoint('src/sample.ts', 7, guard)
  expect(state.binding.trace.removePoint).toHaveBeenCalledExactlyOnceWith('sample-point')
  expect(guard).toHaveBeenCalledTimes(3)
  await expect(activeTraceContext()!.removePoint('src/sample.ts', 8)).rejects.toThrow(
    'No record point'
  )
})
