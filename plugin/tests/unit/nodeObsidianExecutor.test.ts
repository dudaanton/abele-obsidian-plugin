import { describe, expect, it, vi } from 'vitest'
import {
  NodeObsidianExecutor,
  ObsidianNotExecuted,
  type ObsidianInvocation,
  type ObsidianExecutionReceipt,
  type ObsidianToolAdapter,
} from '@/node/NodeObsidianExecutor'

const invocation = (extra: Partial<ObsidianInvocation> = {}): ObsidianInvocation => ({
  invocation_id: 'invocation-1',
  session_id: 'session-1',
  run_id: 'run-1',
  call_id: 'call-1',
  installation_id: 'installation-1',
  vault_id: 'vault-1',
  agent_id: 'agent-1',
  revision: 'revision-1',
  tool_name: 'create',
  arguments: { path: 'sample.md', content: 'Hello' },
  state: 'ready',
  executor: { installation_id: 'installation-1', client_id: 'client-1' },
  created_at: 1,
  action: 'claim',
  preview: { path: 'sample.md', content: 'Hello' },
  ...extra,
})
function setup() {
  const receipts = new Map<string, ObsidianExecutionReceipt>()
  const save = vi.fn(async (id: string, receipt: ObsidianExecutionReceipt) => {
    receipts.set(id, structuredClone(receipt))
  })
  const execute = vi.fn<ObsidianToolAdapter['execute']>(async () => ({
    content: [{ type: 'text', text: 'Created' }],
  }))
  const prepare = vi.fn(async () => ({
    preview: { path: 'sample.md', content: 'Hello' },
    needsApproval: false,
  }))
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method.endsWith('.claim')) return { execute: true, invocation: invocation(), bypass: false }
    if (method.endsWith('.prepare')) return invocation()
    return { ...invocation(), ...params }
  })
  const hosted = vi.fn(async () => {})
  const executor = new NodeObsidianExecutor({
    clientId: 'client-1',
    vaultId: 'vault-1',
    request,
    hosted,
    receipt: async (id) => receipts.get(id),
    save,
    resolve: async () => ({ revision: 'revision-1', prepare, execute }),
  })
  return { executor, execute, prepare, request, receipts, save, hosted }
}
describe('node Obsidian executor', () => {
  it.each(['questions', 'delegate'])(
    'requires fresh approval evidence for hosted %s',
    async (tool_name) => {
      const s = setup()
      s.prepare.mockResolvedValueOnce({ preview: invocation().preview!, needsApproval: true })
      await s.executor.accept(invocation({ tool_name, action: 'hosted' }))
      expect(s.request).toHaveBeenCalledExactlyOnceWith(
        'obsidian.tools.v1.prepare',
        expect.objectContaining({ needs_approval: true })
      )
      expect(s.hosted).not.toHaveBeenCalled()
      expect(s.save).not.toHaveBeenCalled()
    }
  )
  it('persists admission before opening fresh hosted delegation', async () => {
    const s = setup()
    s.hosted.mockImplementationOnce(async () => {
      expect(s.prepare).toHaveBeenCalledOnce()
      expect(s.receipts.get('invocation-1')).toMatchObject({
        state: 'executing',
        sessionId: 'session-1',
        runId: 'run-1',
      })
    })
    await s.executor.accept(invocation({ tool_name: 'delegate', action: 'hosted' }))
    expect(s.hosted).toHaveBeenCalledOnce()
  })
  it('does not open fresh hosted delegation when durable admission fails', async () => {
    const s = setup()
    s.save.mockRejectedValueOnce(new Error('Storage unavailable'))
    await expect(
      s.executor.accept(invocation({ tool_name: 'delegate', action: 'hosted' }))
    ).rejects.toThrow('Storage unavailable')
    expect(s.hosted).not.toHaveBeenCalled()
  })
  it.each(['questions', 'delegate'])(
    'checks policy before receiptless hosted %s',
    async (tool_name) => {
      const s = setup()
      s.prepare.mockRejectedValueOnce(new ObsidianNotExecuted('Tool disabled or depth exhausted'))
      await s.executor.accept(invocation({ tool_name, action: 'hosted', state: 'executing' }))
      expect(s.prepare).toHaveBeenCalledOnce()
      expect(s.hosted).not.toHaveBeenCalled()
      expect(s.request.mock.calls.some(([m]) => m.endsWith('.questions.open'))).toBe(false)
    }
  )
  it.each(['questions', 'delegate'])(
    'settles receiptless %s recovery without starting',
    async (tool_name) => {
      const s = setup()
      await s.executor.accept(invocation({ tool_name, action: 'reconcile', state: 'executing' }))
      expect(s.hosted).not.toHaveBeenCalled()
      expect(s.request.mock.calls.some(([m]) => m.endsWith('.questions.open'))).toBe(false)
      expect(s.request).toHaveBeenLastCalledWith(
        'obsidian.tools.v1.complete',
        expect.objectContaining({ state: 'outcome_unknown' })
      )
    }
  )
  it.each(['cancel', 'hosted'] as const)(
    'never starts receiptless cancelled delegation via %s',
    async (action) => {
      const s = setup()
      await s.executor.accept(
        invocation({ tool_name: 'delegate', action, state: 'executing', cancel_requested: true })
      )
      expect(s.hosted).not.toHaveBeenCalled()
      expect(s.prepare).not.toHaveBeenCalled()
    }
  )
  it('resumes delegation only with an executing receipt belonging to this run', async () => {
    const s = setup()
    const i = invocation({ tool_name: 'delegate' })
    await s.executor.accept(i)
    await s.executor.accept({ ...i, action: 'hosted' })
    expect(s.hosted).toHaveBeenCalledTimes(2)
    expect(s.prepare).toHaveBeenCalledOnce()
    await s.executor.accept({ ...i, action: 'hosted', run_id: 'other-run' })
    expect(s.hosted).toHaveBeenCalledTimes(2)
  })
  it('never reopens a hosted invocation with a terminal receipt', async () => {
    const s = setup()
    s.receipts.set('invocation-1', { state: 'failed', result: {} })
    await s.executor.accept(invocation({ tool_name: 'questions', action: 'hosted' }))
    expect(s.request.mock.calls.some(([m]) => m.endsWith('.questions.open'))).toBe(false)
  })
  it('opens a claimed questionnaire and recovers it without generic completion', async () => {
    const s = setup()
    const i = invocation({ tool_name: 'questions' })
    await s.executor.accept(i)
    await s.executor.accept({ ...i, action: 'reconcile', state: 'executing' })
    expect(s.request.mock.calls.filter(([m]) => m.endsWith('.questions.open'))).toHaveLength(2)
    expect(s.request.mock.calls.some(([m]) => m.endsWith('.complete'))).toBe(false)
    expect(s.execute).not.toHaveBeenCalled()
  })
  it('flushes intent before effects and saves the result before completing', async () => {
    const s = setup()
    s.execute.mockImplementationOnce(async () => {
      expect(s.receipts.get('invocation-1').state).toBe('executing')
      return { content: [{ type: 'text', text: 'Created' }] }
    })
    await s.executor.accept(invocation())
    expect(s.execute).toHaveBeenCalledTimes(1)
    expect(s.receipts.get('invocation-1').state).toBe('succeeded')
    expect(s.request.mock.calls.at(-1)?.[0]).toBe('obsidian.tools.v1.complete')
  })
  it('reconciles a lost result reply without repeating the handler', async () => {
    const s = setup()
    s.request.mockImplementation(async (method) => {
      if (method.endsWith('.claim'))
        return { execute: true, invocation: invocation(), bypass: false }
      throw new Error('disconnected')
    })
    await expect(s.executor.accept(invocation())).rejects.toThrow('disconnected')
    await expect(
      s.executor.accept(invocation({ action: 'reconcile', state: 'executing' }))
    ).rejects.toThrow('disconnected')
    expect(s.execute).toHaveBeenCalledTimes(1)
    expect(s.receipts.get('invocation-1').state).toBe('succeeded')
  })
  it('reports unknown after a lost claim reply without executing', async () => {
    const s = setup()
    await s.executor.accept(invocation({ action: 'reconcile', state: 'executing' }))
    expect(s.execute).not.toHaveBeenCalled()
    expect(s.request).toHaveBeenLastCalledWith(
      'obsidian.tools.v1.complete',
      expect.objectContaining({ state: 'outcome_unknown' })
    )
  })
  it('never executes a duplicate claim or a call from another vault', async () => {
    const s = setup()
    s.request.mockResolvedValue({ execute: false, invocation: invocation() })
    await s.executor.accept(invocation())
    await s.executor.accept(invocation({ vault_id: 'other-vault' }))
    expect(s.execute).not.toHaveBeenCalled()
    expect(s.request).toHaveBeenCalledTimes(1)
  })
  it('prepares changed evidence again rather than claiming the old approval', async () => {
    const s = setup()
    await s.executor.accept(invocation({ preview: { content: 'old' } }))
    expect(s.request).toHaveBeenCalledWith(
      'obsidian.tools.v1.prepare',
      expect.objectContaining({ preview: { path: 'sample.md', content: 'Hello' } })
    )
    expect(s.execute).not.toHaveBeenCalled()
  })
  it('prepares again when scope now requires approval even if the file preview is unchanged', async () => {
    const s = setup()
    s.prepare.mockResolvedValueOnce({
      preview: { path: 'sample.md', content: 'Hello' },
      needsApproval: true,
    })
    await s.executor.accept(invocation({ prepared_needs_approval: false }))
    expect(s.request).toHaveBeenCalledWith(
      'obsidian.tools.v1.prepare',
      expect.objectContaining({ needs_approval: true })
    )
    expect(s.execute).not.toHaveBeenCalled()
  })
  it('cancels stale permissions before a claim', async () => {
    const s = setup()
    await s.executor.accept(invocation({ revision: 'old-revision' }))
    expect(s.request).toHaveBeenCalledWith('obsidian.tools.v1.cancel', {
      invocation_id: 'invocation-1',
    })
    expect(s.execute).not.toHaveBeenCalled()
  })
  it('serializes overlapping deliveries of the same invocation', async () => {
    const s = setup()
    await Promise.all([s.executor.accept(invocation()), s.executor.accept(invocation())])
    expect(s.execute).toHaveBeenCalledTimes(1)
  })
  it('does not retry a handler after an uncertain failure', async () => {
    const s = setup()
    s.execute.mockRejectedValueOnce(new Error('write failed after admission'))
    await s.executor.accept(invocation())
    await s.executor.accept(invocation({ state: 'executing', action: 'reconcile' }))
    expect(s.execute).toHaveBeenCalledTimes(1)
    expect(s.receipts.get('invocation-1').state).toBe('outcome_unknown')
  })

  it('never runs a handler when the durable intent cannot be saved', async () => {
    const s = setup()
    s.save.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(s.executor.accept(invocation())).rejects.toThrow('storage unavailable')
    expect(s.execute).not.toHaveBeenCalled()
    await s.executor.accept(invocation({ action: 'reconcile', state: 'executing' }))
    expect(s.receipts.get('invocation-1').state).toBe('outcome_unknown')
    expect(s.execute).not.toHaveBeenCalled()
  })

  it('does not execute if the claim response was lost', async () => {
    const s = setup()
    s.request.mockRejectedValueOnce(new Error('lost claim reply'))
    await expect(s.executor.accept(invocation())).rejects.toThrow('lost claim reply')
    await s.executor.accept(invocation({ action: 'reconcile', state: 'executing' }))
    expect(s.execute).not.toHaveBeenCalled()
    expect(s.receipts.get('invocation-1').state).toBe('outcome_unknown')
  })

  it('aborts a running handler cooperatively when Stop arrives', async () => {
    const s = setup()
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    s.execute.mockImplementationOnce(async (_invocation, _bypass, signal) => {
      entered()
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Stopped after admission')), {
          once: true,
        })
      })
      return { content: [] }
    })
    const running = s.executor.accept(invocation())
    await started
    await s.executor.accept(
      invocation({ state: 'executing', action: 'cancel', cancel_requested: true })
    )
    await running
    expect(s.execute).toHaveBeenCalledTimes(1)
    expect(s.receipts.get('invocation-1').state).toBe('outcome_unknown')
  })

  it('does not prepare, claim or execute a call cancelled before admission', async () => {
    const s = setup()
    await s.executor.accept(invocation({ action: 'cancel', state: 'cancelled' }))
    expect(s.prepare).not.toHaveBeenCalled()
    expect(s.request).not.toHaveBeenCalled()
    expect(s.execute).not.toHaveBeenCalled()
  })
})
