import { expect, it, vi } from 'vitest'
import { DebuggerController } from '@/debugger/DebuggerController'
import { debuggerSnapshot } from '../fixtures/debugger'
import { DebuggerBinding } from '@/debugger/DebuggerService'
import { DebuggerClient } from '@abele/node-client'
import { ref } from 'vue'
import type { NodeConnection } from '@/node/NodeService'
import { flushPromises } from '@vue/test-utils'

function fixture(owned = false) {
  const snapshot = debuggerSnapshot()
  snapshot.target.process_ownership = owned ? 'owned' : 'external'
  const command = vi.fn(async (_method: string, params: unknown) => ({
    operation_id: (params as { operation_id: string }).operation_id,
    acceptance: 'accepted',
    dispatch: 'dispatched',
    outcome: 'completed',
    completed_at: '2025-01-01T00:00:00.000Z',
    snapshot,
  }))
  const rpc = vi.fn((_method: string, _params: unknown): Promise<unknown> => new Promise(() => {}))
  const cancelPending = vi.fn()
  const controller = new DebuggerController({ rpc, command, cancelPending }, () => {})
  controller.observe({ observation: 'current', snapshot })
  return { controller, command, rpc, cancelPending, snapshot }
}

it.each([false, true])(
  'disconnect preempts a pending owner control and updates the UI immediately (owned: %s)',
  async (owned) => {
    const { controller, command, rpc, cancelPending, snapshot } = fixture(owned)
    const blocked = controller.command('pause')
    // Start a real queued control: this read never answers, like an in-flight inspection.
    controller.session.status = 'running'
    const queued = controller.command('pause')
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled())
    const started = performance.now()
    const stopping = controller.command('stop')
    expect(controller.current).toBe(false)
    expect(controller.session.status).toBe('exited')
    expect(cancelPending).toHaveBeenCalledOnce()
    await stopping
    expect(performance.now() - started).toBeLessThan(300)
    expect(command).toHaveBeenCalledExactlyOnceWith(
      owned ? 'terminate' : 'detach',
      expect.anything()
    )
    controller.observe({ observation: 'current', snapshot })
    expect(controller.current).toBe(false)
    expect(controller.session.status).toBe('exited')
    await Promise.all([blocked, queued])
  }
)

it('keeps disconnect unconfirmed when the node rejects it', async () => {
  const { controller, command } = fixture()
  command.mockRejectedValueOnce(new Error('sample disconnect failure'))
  await expect(controller.command('stop')).rejects.toThrow('sample disconnect failure')
  expect(controller.current).toBe(false)
  expect(controller.session.status).toBe('lost')
  expect(controller.session.detached).toBe(false)
})

it('can approve only the exact owner disconnect while the UI is already disconnected', async () => {
  const { controller, command, rpc } = fixture()
  const completed = await command('detach', { operation_id: 'sample-operation' })
  command.mockClear()
  command.mockResolvedValueOnce({
    ...completed,
    outcome: 'pending',
    dispatch: 'not_dispatched',
    proposal_hash: 'a'.repeat(64),
  } as never)
  rpc.mockImplementation(async (method, params) => {
    if (method === 'debugger.v1.approvals')
      return {
        proposals: [
          {
            key: 'sample-key',
            principal_key: 'sample-human',
            actor: { kind: 'human', principal_id: 'sample-human' },
            method: 'detach',
            params: command.mock.calls[0][1],
            receipt: {
              ...completed,
              operation_id: (command.mock.calls[0][1] as { operation_id: string }).operation_id,
              outcome: 'pending',
              dispatch: 'not_dispatched',
              proposal_hash: 'a'.repeat(64),
            },
          },
        ],
        truncated: false,
        next: null,
      }
    if (method === 'debugger.v1.approve')
      return { ...completed, operation_id: (params as { operation_id: string }).operation_id }
    throw new Error('Unexpected fixture RPC')
  })
  await controller.command('stop')
  expect(rpc).toHaveBeenCalledWith(
    'debugger.v1.approve',
    expect.objectContaining({
      principal_key: 'sample-human',
      decision: 'approve',
      proposal_hash: 'a'.repeat(64),
    })
  )
  expect(controller.session.status).toBe('exited')
  expect(controller.current).toBe(false)
})

it('cancels a pending event wait and sends detach without an SDK status preflight', async () => {
  const snapshot = debuggerSnapshot()
  snapshot.target.process_ownership = 'external'
  let finishWait!: (value: unknown) => void
  const rpc = vi.fn(async (method: string, params: any) => {
    if (method === 'debugger.v1.status') {
      if (rpc.mock.calls.filter(([name]) => name === method).length > 1)
        return new Promise(() => {})
      return {
        snapshot,
        cursor: {
          debug_session_id: snapshot.debug_session_id,
          incarnation: snapshot.incarnation,
          event_seq: snapshot.event_seq,
        },
      }
    }
    if (method === 'debugger.v1.wait')
      return new Promise((resolve) => {
        finishWait = resolve
      })
    if (method === 'debugger.v1.cancelWait') return {}
    if (method === 'debugger.v1.detach')
      return {
        operation_id: params.operation_id,
        acceptance: 'accepted',
        dispatch: 'dispatched',
        outcome: 'completed',
        completed_at: '2025-01-01T00:00:00.000Z',
        snapshot,
      }
    throw new Error(`Unexpected fixture method: ${method}`)
  })
  const state = ref('connected')
  const binding = new DebuggerBinding(
    {
      state,
      client: { request: rpc, debugger: new DebuggerClient(rpc) },
    } as unknown as NodeConnection,
    'sample-chat',
    'sample-registration'
  )
  vi.spyOn(binding, 'refresh').mockResolvedValue(undefined)
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    await binding.open(snapshot.debug_session_id)
    await vi.waitFor(() => expect(finishWait).toBeTypeOf('function'))
    const start = performance.now()
    await Promise.race([
      binding.controller.command('stop'),
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('disconnect exceeded 300ms')), 300)
      }),
    ])
    expect(performance.now() - start).toBeLessThan(300)
    expect(rpc).toHaveBeenCalledWith('debugger.v1.cancelWait', expect.anything())
    expect(rpc).toHaveBeenCalledWith('debugger.v1.detach', expect.anything())
    finishWait({ wait_id: 'sample-wait', reason: 'elapsed', elapsed_ms: 4000, snapshot })
    await flushPromises()
    expect(binding.controller.current).toBe(false)
    state.value = 'disconnected'
    state.value = 'connected'
    expect(rpc.mock.calls.filter(([name]) => name === 'debugger.v1.status')).toHaveLength(1)
  } finally {
    clearTimeout(deadline)
    binding.destroy()
  }
})
