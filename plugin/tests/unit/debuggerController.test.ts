import { describe, expect, it, vi } from 'vitest'
import {
  DebuggerSnapshotSchema,
  DebuggerReceiptSchema,
  DebuggerGrantSchema,
} from '@abele/node-protocol'
import { DebuggerController, debuggerKey } from '@/debugger/DebuggerController'

export function snapshot(patch = {}) {
  return DebuggerSnapshotSchema.parse({
    version: 'debugger.v1',
    debug_session_id: 'sample-debug',
    incarnation: 'sample-incarnation',
    state_revision: 4,
    breakpoint_revision: 2,
    event_seq: 8,
    stop_epoch: 3,
    observed_at: '2025-01-01T00:00:00.000Z',
    target: {
      node_id: 'sample-node',
      project_id: 'sample-project',
      workspace_id: null,
      worktree_id: 'sample-tree',
      conversation_id: 'sample-chat',
      target_id: 'sample-target',
      adapter_profile: 'sample-js',
      adapter_version: 'sample-version',
      launch_configuration_id: 'sample-launch',
      process_ownership: 'owned',
      build_identity: 'matched',
    },
    lifecycle: 'active',
    execution: 'stopped',
    threads: [
      {
        thread_id: 1,
        name: 'main',
        status: 'stopped',
        stop: {
          reason: 'breakpoint',
          hit_breakpoint_ids: [],
          location: { source_id: 'sample-source', line: 7 },
        },
      },
    ],
    thread_inventory: 'complete',
    all_threads_status: 'stopped',
    selected_thread_id: 1,
    selected_frame_handle: null,
    breakpoints: [],
    adapter_capabilities: [],
    pending_approvals: [],
    pending_commands: [],
    ...patch,
  })
}
const receipt = (outcome = 'completed', patch = {}) =>
  DebuggerReceiptSchema.parse({
    operation_id: 'sample-operation',
    acceptance: 'accepted',
    dispatch: outcome === 'pending' ? 'not_dispatched' : 'dispatched',
    outcome,
    completed_at: '2025-01-01T00:00:00.000Z',
    snapshot: snapshot(),
    proposal_hash: 'a'.repeat(64),
    ...patch,
  })
function grant(patch = {}) {
  return DebuggerGrantSchema.parse({
    grant_id: 'sample-grant',
    installation_id: 'sample-installation',
    run_id: 'sample-run',
    task_id: 'sample-task',
    conversation_id: 'sample-chat',
    workspace_id: null,
    target_id: 'sample-target',
    debug_session_id: 'sample-debug',
    incarnation: 'sample-incarnation',
    expires_at: new Date(Date.now() + 60000).toISOString(),
    actions: ['read', 'step'],
    mode: 'allow-all',
    revoked: false,
    owner_authority: { installation_id: 'sample-owner', profile: 'local-token-v1' },
    controller_authority: { installation_id: 'sample-installation', profile: 'local-token-v1' },
    ...patch,
  })
}
function fixture() {
  const rpc = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'debugger.v1.approve')
      return (params as { decision?: string })?.decision === 'deny'
        ? receipt('rejected', { dispatch: 'not_dispatched', code: 'denied' })
        : receipt()
    if (method === 'debugger.v1.approvals') return { proposals: [], truncated: false, next: null }
    return []
  })
  const command = vi.fn(async () => receipt())
  const model = new DebuggerController({ rpc, command }, () => {})
  model.observe({ observation: 'current', snapshot: snapshot() })
  model.addProposal({
    key: 'sample-key',
    principal_key: 'sample-principal',
    actor: { kind: 'agent', principal_id: 'sample-agent', run_id: 'sample-run' },
    method: 'step',
    params: {
      debug_session_id: 'sample-debug',
      incarnation: 'sample-incarnation',
      expected_state_revision: 4,
      operation_id: 'sample-operation',
      thread_id: 1,
      kind: 'over',
    },
    receipt: receipt('pending'),
  })
  return { model, rpc, command }
}
describe('debugger shared control', () => {
  it('expires every pending request before a human move and never approves it later', async () => {
    const { model, rpc, command } = fixture()
    await model.command('step-over')
    expect(model.actions[0].status).toBe('expired')
    expect(rpc).toHaveBeenCalledWith(
      'debugger.v1.approve',
      expect.objectContaining({ decision: 'deny', proposal_hash: 'a'.repeat(64) })
    )
    expect(command).toHaveBeenCalledWith(
      'step',
      expect.objectContaining({ expected_state_revision: 4, kind: 'over' })
    )
    const count = rpc.mock.calls.length
    await model.decide(model.actions[0].id, true)
    expect(rpc.mock.calls.length).toBe(count)
  })
  it('sends no human effect unless every exact proposal retirement is terminal', async () => {
    const { model, rpc, command } = fixture()
    rpc.mockResolvedValueOnce({ proposals: [], truncated: false, next: null } as never)
    rpc.mockResolvedValueOnce(receipt('pending') as never)
    await expect(model.command('step-over')).rejects.toThrow()
    expect(command).not.toHaveBeenCalled()
  })
  it('does not call done for a pending or uncertain approval result', async () => {
    const { model, rpc } = fixture()
    rpc.mockResolvedValueOnce(receipt('pending') as never)
    await model.decide(model.actions[0].id, true)
    expect(model.actions[0].status).toBe('asked')
    expect(model.actions[0].awaitingResult).toBe(true)
  })
  it('keeps the last state on disconnect, expires asks, ignores late observations and sends nothing', async () => {
    const { model, rpc, command } = fixture()
    model.disconnected()
    model.observe({ observation: 'last-known', snapshot: snapshot({ event_seq: 9 }) })
    expect(model.session.status).toBe('lost')
    expect(model.session.seen).toBeTruthy()
    expect(model.actions[0].status).toBe('expired')
    await model.command('continue')
    await model.decide(model.actions[0].id, true)
    expect(rpc).not.toHaveBeenCalled()
    expect(command).not.toHaveBeenCalled()
    model.observe({ observation: 'current', snapshot: snapshot({ event_seq: 10 }) })
    expect(model.session.status).toBe('paused')
    expect(command).not.toHaveBeenCalled()
  })
  it('does not dispatch a human move when expiring the remote proposal fails', async () => {
    const { model, rpc, command } = fixture()
    rpc.mockRejectedValueOnce(new Error('sample connection lost'))
    await expect(model.command('step-over')).rejects.toThrow()
    expect(command).not.toHaveBeenCalled()
    expect(model.session.status).toBe('lost')
  })
  it('uses the exact proposal hash, and only explicit deny becomes denied', async () => {
    const { model, rpc } = fixture()
    await model.decide(model.actions[0].id, false)
    expect(rpc).toHaveBeenCalledWith('debugger.v1.approve', {
      principal_key: 'sample-principal',
      operation_id: 'sample-operation',
      proposal_hash: 'a'.repeat(64),
      decision: 'deny',
    })
    expect(model.actions[0].status).toBe('denied')
  })
  it('never resurrects a late command reply after disconnect', async () => {
    const { model, command } = fixture()
    let resolve!: (v: ReturnType<typeof receipt>) => void
    command.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    const pending = model.command('step-over')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    model.disconnected()
    resolve(receipt())
    await pending
    expect(model.session.status).toBe('lost')
  })
  it('rejects an old stack reply even when reconnect keeps the same stop epoch', async () => {
    const { model, rpc } = fixture()
    let resolve!: (v: unknown) => void
    rpc.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }) as never
    )
    const pending = model.loadStack()
    model.disconnected()
    model.observe({ observation: 'current', snapshot: snapshot() })
    resolve({
      data: {
        items: [
          { handle: 'sample-old-frame', name: 'staleFrame', source_id: 'sample-source', line: 7 },
        ],
      },
    })
    await pending
    expect(model.session.frames[0].name).not.toBe('staleFrame')
  })
  it('retires pending proposals before switching a live grant to allow-all', async () => {
    const { model, rpc } = fixture()
    model.grantId = 'sample-grant'
    rpc.mockResolvedValueOnce({ proposals: [], truncated: false, next: null } as never)
    rpc.mockResolvedValueOnce(
      receipt('rejected', { dispatch: 'not_dispatched', code: 'denied' }) as never
    )
    rpc.mockResolvedValueOnce(grant() as never)
    await model.setMode('allow')
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'debugger.v1.approvals',
      'debugger.v1.approve',
      'debugger.v1.grant.setMode',
    ])
    expect(model.actions[0].status).toBe('expired')
    expect(model.session.mode).toBe('allow')
  })
  it('rejects a mode confirmation for a different grant', async () => {
    const { model, rpc } = fixture()
    model.grantId = 'sample-grant'
    rpc.mockResolvedValueOnce({ proposals: [], truncated: false, next: null } as never)
    rpc.mockResolvedValueOnce(
      receipt('rejected', { dispatch: 'not_dispatched', code: 'denied' }) as never
    )
    rpc.mockResolvedValueOnce(grant({ grant_id: 'sample-other-grant' }) as never)
    await expect(model.setMode('allow')).rejects.toThrow()
    expect(model.session.mode).toBe('ask')
  })
  it('stops an externally owned target by detaching, never terminating it', async () => {
    const { model, command } = fixture()
    model.observe({
      observation: 'current',
      snapshot: snapshot({ target: { ...snapshot().target, process_ownership: 'external' } }),
    })
    await model.command('stop')
    expect(command).toHaveBeenCalledWith(
      'detach',
      expect.objectContaining({ debug_session_id: 'sample-debug' })
    )
  })
  it('labels an evicted action result rather than presenting an empty success', async () => {
    const { model, rpc } = fixture()
    rpc.mockResolvedValueOnce({
      entries: [
        {
          actor: { kind: 'agent', principal_id: 'sample-agent', run_id: 'sample-run' },
          operation_id: 'sample-operation',
          operation: 'evaluate',
          outcome: 'completed',
          debug_session_id: 'sample-debug',
          history_seq: 1,
          event_seq: 8,
          stop: null,
          observed_at: '2025-01-01T00:00:00.000Z',
          incarnation: 'sample-incarnation',
          stop_epoch: 3,
          state_revision: 4,
          target_id: 'sample-target',
          build_identity: 'matched',
          payload_status: 'expired',
        },
      ],
      truncated_before: 0,
    } as never)
    await model.refreshHistory()
    expect(model.actions[0].status).toBe('done')
    expect(model.actions[0].result).toContain('no longer retained')
  })
  it('keeps receipts from different agent principals separate when operation IDs coincide', async () => {
    const { model, rpc } = fixture()
    const actor = { kind: 'agent', principal_id: 'sample-other-agent', run_id: 'sample-other-run' }
    model.addProposal({
      key: 'sample-other-key',
      principal_key: 'sample-other-principal',
      actor,
      method: 'step',
      params: {
        debug_session_id: 'sample-debug',
        incarnation: 'sample-incarnation',
        expected_state_revision: 4,
        operation_id: 'sample-operation',
        thread_id: 1,
        kind: 'over',
      },
      receipt: receipt('pending'),
    })
    rpc.mockResolvedValueOnce({
      entries: [
        {
          actor,
          operation_id: 'sample-operation',
          operation: 'step',
          outcome: 'completed',
          debug_session_id: 'sample-debug',
          history_seq: 1,
          event_seq: 8,
          stop: null,
          observed_at: '2025-01-01T00:00:00.000Z',
          incarnation: 'sample-incarnation',
          stop_epoch: 3,
          state_revision: 4,
          target_id: 'sample-target',
          build_identity: 'matched',
          payload_status: 'absent',
        },
      ],
      truncated_before: 0,
    } as never)
    await model.refreshHistory()
    expect(model.actions.map((a) => a.status)).toEqual(['asked', 'done'])
  })
  it('does not run unavailable restart or claim unknown aggregate execution is paused', async () => {
    const { model, command } = fixture()
    await model.command('restart')
    expect(command).not.toHaveBeenCalled()
    model.observe({ observation: 'current', snapshot: snapshot({ execution: 'mixed' }) })
    expect(model.session.status).not.toBe('paused')
  })
})
it('routes function keys except text fields and respects modifiers', () => {
  expect(debuggerKey({ key: 'F11', shiftKey: true })).toBe('step-out')
  expect(debuggerKey({ key: 'F5', shiftKey: true })).toBe('stop')
  expect(debuggerKey({ key: 'F6' })).toBe('pause')
  expect(debuggerKey({ key: 'F5', ctrlKey: true })).toBeUndefined()
  expect(
    debuggerKey({ key: 'F10', target: { closest: () => document.createElement('input') } as never })
  ).toBeUndefined()
  expect(debuggerKey({ key: 'F10', target: document.createElement('input') })).toBeUndefined()
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'true')
  expect(debuggerKey({ key: 'F11', target: editable })).toBeUndefined()
})
