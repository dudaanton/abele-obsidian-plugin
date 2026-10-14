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
  const proposal = {
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
  }
  model.addProposal(proposal)
  return { model, rpc, command, proposal }
}
describe('debugger shared control', () => {
  it.each(['session', 'incarnation', 'round-trip'])(
    'drops an invocation after %s replacement during retirement',
    async (replacement) => {
      const { model, rpc, command } = fixture()
      let resolve!: (v: unknown) => void
      rpc.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r
          }) as never
      )
      const pending = model.command('stop')
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
      model.observe({
        observation: 'current',
        snapshot: snapshot(
          replacement === 'incarnation'
            ? { incarnation: 'sample-new-incarnation' }
            : { debug_session_id: 'sample-other-debug' }
        ),
      })
      if (replacement === 'round-trip')
        model.observe({ observation: 'current', snapshot: snapshot() })
      resolve({ proposals: [], truncated: false, next: null })
      await pending
      expect(command).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalledWith('debugger.v1.approve', expect.anything())
    }
  )
  it('submits an owner move while an earlier approval RPC is still awaiting its result', async () => {
    const { model, rpc, command } = fixture()
    let resolve!: (v: unknown) => void
    rpc.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }) as never
    )
    const approval = model.decide(model.actions[0].id, true)
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    const move = model.command('stop')
    try {
      await vi.waitFor(
        () =>
          expect(command).toHaveBeenCalledWith(
            'terminate',
            expect.objectContaining({ debug_session_id: 'sample-debug' })
          ),
        { timeout: 150 }
      )
    } finally {
      resolve(receipt())
      await approval
      await move
    }
  })
  it('does not join an in-flight approval through a raced proposal-page denial', async () => {
    const { model, rpc, command, proposal } = fixture()
    let resolve!: (v: unknown) => void
    const submitted = new Promise((r) => {
      resolve = r
    })
    rpc.mockImplementation(async (method) => {
      if (method === 'debugger.v1.approve') return submitted as never
      if (method === 'debugger.v1.approvals')
        return { proposals: [proposal], truncated: false, next: null } as never
      return [] as never
    })
    const approval = model.decide(model.actions[0].id, true)
    const move = model.command('stop')
    try {
      await vi.waitFor(() => expect(command).toHaveBeenCalled(), { timeout: 150 })
    } finally {
      resolve(receipt())
      await approval
      await move
    }
    expect(rpc.mock.calls.filter((c) => c[0] === 'debugger.v1.approve')).toHaveLength(1)
  })
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
  it('does not call an already completed action successfully retired or dispatch the stale owner intent', async () => {
    const { model, rpc, command } = fixture()
    rpc.mockResolvedValueOnce({ proposals: [], truncated: false, next: null } as never)
    rpc.mockResolvedValueOnce(receipt() as never)
    await expect(model.command('stop')).rejects.toThrow('retirement')
    expect(command).not.toHaveBeenCalled()
    expect(model.actions[0].status).toBe('done')
    expect(model.actions[0].result).toContain('not confirmed')
  })
  it.fails(
    'BUG: an owner move cannot bypass a cross-window approved intent without a node retirement fence',
    async () => {
      const { model, rpc, command } = fixture()
      let resolve!: (v: unknown) => void
      rpc.mockImplementationOnce(
        async () => ({ proposals: [], truncated: false, next: null }) as never
      )
      rpc.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r
          }) as never
      )
      const move = model.command('stop')
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
      try {
        await vi.waitFor(() => expect(command).toHaveBeenCalled(), { timeout: 150 })
      } finally {
        resolve(receipt())
        await move.catch(() => {})
      }
    }
  )
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
  it.each([
    ['completed', 'dispatched', 'done', false],
    ['pending', 'not_dispatched', 'asked', true],
    ['outcome_unknown', 'possible', 'unknown', false],
    ['rejected', 'dispatched', 'unknown', false],
  ])(
    'Deny displays the actual %s/%s receipt, not denial success',
    async (outcome, dispatch, status, awaiting) => {
      const { model, rpc } = fixture()
      rpc.mockResolvedValueOnce(receipt(outcome as string, { dispatch }) as never)
      await model.decide(model.actions[0].id, false)
      expect(model.actions[0].status).toBe(status)
      expect(!!model.actions[0].awaitingResult).toBe(awaiting)
    }
  )
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
  it("selects the program's own frame when Node's internals are on top of the stack", async () => {
    const { model, rpc } = fixture()
    rpc.mockResolvedValueOnce({
      data: {
        items: [
          { handle: 'sample-internal-a', name: 'internalStatement', source_id: null, line: 3 },
          { handle: 'sample-internal-b', name: 'internalLoader', source_id: null, line: 9 },
          { handle: 'sample-own', name: 'sampleMain', source_id: 'sample-source', line: 7 },
          { handle: 'sample-caller', name: 'sampleCaller', source_id: 'sample-source', line: 2 },
        ],
      },
    } as never)
    await model.loadStack()
    expect(model.session.frame).toBe(2)
    expect(model.session.frames[model.session.frame].name).toBe('sampleMain')
  })
  it("keeps the top frame selected when it is the program's own or no frame has a source", async () => {
    const { model, rpc } = fixture()
    rpc.mockResolvedValueOnce({
      data: {
        items: [
          { handle: 'sample-own', name: 'sampleMain', source_id: 'sample-source', line: 7 },
          { handle: 'sample-internal', name: 'internalLoader', source_id: null, line: 9 },
        ],
      },
    } as never)
    await model.loadStack()
    expect(model.session.frame).toBe(0)
    rpc.mockResolvedValueOnce({
      data: {
        items: [{ handle: 'sample-internal', name: 'internalLoader', source_id: null, line: 9 }],
      },
    } as never)
    await model.loadStack()
    expect(model.session.frame).toBe(0)
  })
  it('does not claim Ask without a live grant, and clears authority on replacement', () => {
    const { model } = fixture()
    expect(model.session.mode).toBe('unknown')
    model.bindGrant(grant({ mode: 'ask' }))
    expect(model.session.mode).toBe('ask')
    model.observe({
      observation: 'current',
      snapshot: snapshot({ incarnation: 'sample-new-incarnation' }),
    })
    expect(model.session.mode).toBe('unknown')
    expect(model.grantId).toBeUndefined()
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
    model.bindGrant(grant({ mode: 'ask' }))
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
  it.each(['outcome_unknown', 'rejected', 'failed'])(
    'does not turn an uncertain decision into non-execution from %s history alone',
    async (outcome) => {
      const { model, rpc } = fixture()
      rpc.mockResolvedValueOnce(receipt('outcome_unknown', { dispatch: 'possible' }) as never)
      await model.decide(model.actions[0].id, false)
      rpc.mockResolvedValueOnce({
        entries: [
          {
            actor: { kind: 'agent', principal_id: 'sample-agent', run_id: 'sample-run' },
            operation_id: 'sample-operation',
            operation: 'step',
            outcome,
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
      expect(model.actions[0].status).toBe('unknown')
    }
  )
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
