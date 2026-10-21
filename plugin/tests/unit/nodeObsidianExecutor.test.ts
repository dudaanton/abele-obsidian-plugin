import { describe, expect, it, vi } from 'vitest'
import {
  NodeObsidianExecutor,
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
  const executor = new NodeObsidianExecutor({
    clientId: 'client-1',
    vaultId: 'vault-1',
    request,
    receipt: async (id) => receipts.get(id),
    save,
    resolve: async () => ({ revision: 'revision-1', prepare, execute }),
  })
  return { executor, execute, prepare, request, receipts, save }
}
describe('node Obsidian executor', () => {
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
