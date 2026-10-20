import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DebugPanel from '@/components/debugger/DebugPanel.vue'
import {
  DebuggerSnapshotSchema,
  DebuggerReceiptSchema,
  DebuggerGrantSchema,
} from '@abele/node-protocol'
import { DebuggerController, debuggerKey, receiptMessage } from '@/debugger/DebuggerController'
import { DebuggerBreakpointRequestSchema } from '@abele/node-protocol'
it.each(['stack', 'scopes'])(
  'ignores a late %s refusal after detach instead of losing the terminal state',
  async (stage) => {
    const { model, rpc } = fixture()
    let complete!: (value: unknown) => void
    rpc.mockImplementation(async (method: string) => {
      if (method === 'debugger.v1.' + stage)
        return new Promise((resolve) => {
          complete = resolve
        }) as never
      if (method === 'debugger.v1.stack')
        return {
          data: {
            items: [
              { handle: 'sample-frame', name: 'sample', source_id: 'sample-source', line: 7 },
            ],
          },
        } as never
      return { data: { items: [] } } as never
    })
    const pending = model.loadStack()
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    model.observe({
      observation: 'current',
      snapshot: snapshot({
        lifecycle: 'detached',
        execution: 'unknown',
        stop_epoch: 4,
        threads: [],
      }),
    })
    complete({ code: 'stale_state' })
    await expect(pending).resolves.toBeUndefined()
    expect(model.session.status).toBe('exited')
  }
)
it('explains an unbound breakpoint without adapter jargon', () => {
  const { model } = fixture()
  model.observe({
    observation: 'current',
    snapshot: snapshot({
      breakpoints: [
        {
          breakpoint_id: 'sample-unbound',
          source_id: 'sample-source',
          line: 7,
          status: 'rejected',
          resolved_line: null,
          resolved_column: null,
          message: 'Unbound breakpoint',
        },
      ],
    }),
  })
  expect(model.knownBreakpoints()[0].reason).toMatch(/program.*not loaded code/i)
  expect(model.session.breakpoints[0].reason).toMatch(/program.*not loaded code/i)
})

it.fails('BUG: the node breakpoint contract must carry a native hit condition', () => {
  expect(
    DebuggerBreakpointRequestSchema.safeParse({
      breakpoint_id: 'sample-bp',
      source_id: 'sample-source',
      line: 7,
      hit_condition: '3',
    }).success
  ).toBe(true)
})

it('updates breakpoint expressions verbatim and preserves the other fields', async () => {
  const { model, command } = fixture()
  model.observe({
    observation: 'current',
    snapshot: snapshot({
      breakpoints: [
        {
          breakpoint_id: 'sample-bp',
          source_id: 'sample-source',
          line: 7,
          column: 2,
          condition: 'n > 0 && n < 4',
          log_message: 'value {n}',
          status: 'verified',
          resolved_line: 7,
          resolved_column: 2,
          message: null,
        },
      ],
    }),
  })
  expect(model.knownBreakpoints()[0]).toMatchObject({ kind: 'log', logMessage: 'value {n}' })
  expect(model.session.breakpoints[0]).toMatchObject({ kind: 'log', logMessage: 'value {n}' })
  await model.editBreakpoint('sample-bp', { log_message: 'new {n}' })
  expect(command).toHaveBeenLastCalledWith(
    'breakpoints.patch',
    expect.objectContaining({
      upsert: [
        {
          breakpoint_id: 'sample-bp',
          source_id: 'sample-source',
          line: 7,
          column: 2,
          condition: 'n > 0 && n < 4',
          log_message: 'new {n}',
        },
      ],
    })
  )
})

it('retains a disabled breakpoint definition for enabling it again', async () => {
  const { model, command } = fixture()
  const bp = {
    breakpoint_id: 'sample-bp',
    source_id: 'sample-source',
    line: 7,
    condition: 'n < 4 && n > 0',
    status: 'verified',
    resolved_line: 7,
    resolved_column: null,
    message: null,
  }
  model.observe({ observation: 'current', snapshot: snapshot({ breakpoints: [bp] }) })
  await model.setBreakpointEnabled('sample-bp', false)
  expect(model.knownBreakpoints()).toContainEqual(
    expect.objectContaining({ id: 'sample-bp', enabled: false, condition: bp.condition })
  )
  model.observe({ observation: 'current', snapshot: snapshot({ breakpoints: [] }) })
  await model.setBreakpointEnabled('sample-bp', true)
  expect(command).toHaveBeenLastCalledWith(
    'breakpoints.patch',
    expect.objectContaining({
      upsert: [expect.objectContaining({ breakpoint_id: 'sample-bp', condition: bp.condition })],
    })
  )
})
it('retires exact pending requests before removing a disabled breakpoint', async () => {
  const { model, proposal, rpc } = fixture()
  model.observe({
    observation: 'current',
    snapshot: snapshot({
      breakpoints: [
        {
          breakpoint_id: 'sample-disabled',
          source_id: 'sample-source',
          line: 7,
          status: 'verified',
          resolved_line: 7,
          resolved_column: null,
          message: null,
        },
      ],
    }),
  })
  await model.setBreakpointEnabled('sample-disabled', false)
  model.addProposal({
    ...proposal,
    key: 'sample-next',
    params: { ...proposal.params, operation_id: 'sample-next' },
    receipt: receipt('pending', { operation_id: 'sample-next' }),
  })
  await model.removeBreakpoint('sample-disabled')
  expect(model.actions.some((a) => a.status === 'asked')).toBe(false)
  expect(rpc).toHaveBeenCalledWith(
    'debugger.v1.approve',
    expect.objectContaining({ operation_id: 'sample-next', decision: 'deny' })
  )
})

it('sets caught and uncaught exception filters through the node command', async () => {
  const { model, command } = fixture()
  await model.setExceptionFilters(['caught', 'uncaught'])
  expect(command).toHaveBeenLastCalledWith(
    'exceptionBreakpoints.set',
    expect.objectContaining({ filters: ['all', 'uncaught'] })
  )
  expect(model.exceptionFilters).toEqual(['caught', 'uncaught'])
})
it('shows a breakpoint another controller enabled instead of hiding it behind local disabled state', async () => {
  const { model } = fixture()
  const point = {
    breakpoint_id: 'sample-shared',
    source_id: 'sample-source',
    line: 7,
    status: 'verified',
    resolved_line: 7,
    resolved_column: null,
    message: null,
  }
  model.observe({ observation: 'current', snapshot: snapshot({ breakpoints: [point] }) })
  await model.setBreakpointEnabled(point.breakpoint_id, false)
  model.observe({
    observation: 'current',
    snapshot: snapshot({ breakpoints: [point], event_seq: 9 }),
  })
  expect(model.knownBreakpoints()[0].enabled).toBe(true)
})

it('makes pending conditional breakpoint approvals available immediately', async () => {
  const { model, command, rpc } = fixture()
  command.mockResolvedValueOnce(receipt('pending'))
  await model.setBreakpoint('sample-bp', 'sample-source', 7, 'n < 4 && n > 0')
  expect(rpc).toHaveBeenCalledWith('debugger.v1.approvals', expect.anything())
  expect(model.error).toBe('')
})

it('loads selected frame scopes on pause without retiring pending approvals', async () => {
  const { model, rpc } = fixture()
  rpc.mockImplementation(async (method: string) => {
    if (method === 'debugger.v1.stack')
      return {
        data: {
          items: [{ handle: 'sample-frame', name: 'sample', source_id: 'sample-source', line: 7 }],
        },
      } as never
    if (method === 'debugger.v1.scopes')
      return { data: { items: [{ name: 'Local', handle: 'sample-local' }] } } as never
    throw new Error(method)
  })
  await model.loadStack()
  expect(model.session.variables).toEqual([
    expect.objectContaining({ name: 'Local', handle: 'sample-local' }),
  ])
  expect(model.actions[0].status).toBe('asked')
})

it('treats an active external session with unknown execution as running on older nodes', () => {
  const { model } = fixture()
  const s = snapshot({ execution: 'unknown', threads: [], selected_thread_id: null })
  s.target.process_ownership = 'external'
  model.observe({ observation: 'current', snapshot: s })
  expect(model.session.status).toBe('running')
})

it('accepts a fresh output snapshot without reporting missing earlier output', async () => {
  const { model, rpc } = fixture()
  rpc.mockResolvedValueOnce({
    kind: 'fresh_snapshot_required',
    reason: 'gap',
    cursor: { debug_session_id: 'sample-debug', incarnation: 'sample-incarnation', event_seq: 8 },
    snapshot: snapshot(),
  } as never)
  await model.refreshOutput()
  expect(model.error).toBe('')
})
it('rebases an unchanged breakpoint intent once after a proven non-dispatched stale-state rejection', async () => {
  const { model, command } = fixture()
  command.mockResolvedValueOnce(
    receipt('rejected', {
      acceptance: 'rejected',
      dispatch: 'not_dispatched',
      code: 'stale_state',
      snapshot: snapshot({ state_revision: 5, event_seq: 9 }),
    })
  )
  command.mockImplementationOnce(async (_method, raw) => {
    const params = raw as { upsert: { breakpoint_id: string; source_id: string; line: number }[] }
    return receipt('completed', {
      snapshot: snapshot({
        state_revision: 6,
        breakpoint_revision: 3,
        event_seq: 10,
        breakpoints: params.upsert.map((point) => ({
          ...point,
          status: 'verified',
          resolved_line: point.line,
          resolved_column: null,
          message: null,
        })),
      }),
    })
  })
  await model.toggleBreakpoint('sample-source', 7)
  expect(command).toHaveBeenCalledTimes(2)
  const first = command.mock.calls[0][1] as Record<string, unknown>
  const second = command.mock.calls[1][1] as Record<string, unknown>
  expect(second).toMatchObject({
    expected_state_revision: 5,
    expected_breakpoint_revision: 2,
    upsert: first.upsert,
    remove: first.remove,
  })
  expect(second.operation_id).not.toBe(first.operation_id)
  expect(model.session.breakpoints).toContainEqual(
    expect.objectContaining({ line: 7, state: 'set' })
  )
  expect(model.error).toBe('')
})
it.each(['possible', 'dispatched', 'incarnation', 'breakpoints'] as const)(
  'does not rebase a breakpoint after %s evidence',
  async (kind) => {
    const { model, command } = fixture()
    const newer = snapshot({
      state_revision: 5,
      event_seq: 9,
      ...(kind === 'incarnation' ? { incarnation: 'sample-new-incarnation' } : {}),
      ...(kind === 'breakpoints' ? { breakpoint_revision: 3 } : {}),
    })
    command.mockResolvedValueOnce(
      receipt(kind === 'possible' ? 'outcome_unknown' : 'rejected', {
        dispatch:
          kind === 'possible'
            ? 'possible'
            : kind === 'dispatched'
              ? 'dispatched'
              : 'not_dispatched',
        code: 'stale_state',
        snapshot: newer,
      })
    )
    await model.toggleBreakpoint('sample-source', 7)
    expect(command).toHaveBeenCalledTimes(1)
  }
)
it('bounds stale-state breakpoint rebasing to one additional attempt', async () => {
  const { model, command } = fixture()
  command.mockResolvedValue(
    receipt('rejected', {
      dispatch: 'not_dispatched',
      code: 'stale_state',
      snapshot: snapshot({ state_revision: 5, event_seq: 9 }),
    })
  )
  await model.toggleBreakpoint('sample-source', 7)
  expect(command).toHaveBeenCalledTimes(2)
  expect(model.error).toBe('stale_state')
})

it('keeps adapter telemetry out of program output while retaining stdout and stderr', async () => {
  const { model, rpc } = fixture()
  rpc.mockResolvedValueOnce({
    kind: 'events',
    cursor: { debug_session_id: 'sample-debug', incarnation: 'sample-incarnation', event_seq: 3 },
    events: ['telemetry', 'stdout', 'stderr'].map((category, i) => ({
      version: 'debugger.v1',
      debug_session_id: 'sample-debug',
      incarnation: 'sample-incarnation',
      event_seq: i + 1,
      state_revision: 4,
      breakpoint_revision: 2,
      stop_epoch: 3,
      observed_at: '2025-01-01T00:00:00.000Z',
      kind: 'output',
      truncated: false,
      data: {
        category,
        text: category === 'telemetry' ? 'js-debug/dap/operation' : `${category}\n`,
      },
    })),
  } as never)
  await model.refreshOutput()
  expect(model.session.output).toBe('stdout\nstderr\n')
})

it('shows the pause reason as visible text without repeating the paused state', () => {
  const { model } = fixture()
  model.session.reason = 'Paused'
  const panel = mount(DebugPanel, { props: { session: model.session } })
  expect(panel.get('.abele-debug-panel__state').text()).toBe('Paused')
  expect(panel.text()).not.toContain('Paused — Paused')
})

it.each([false, true])(
  'keeps inspected scope children when completion is delayed: %s',
  async (delayed) => {
    const { model, rpc, command, proposal } = fixture()
    let completed = !delayed
    let inspectionId = ''
    model.session.variables = [
      { name: 'Local', value: 'Expand to inspect', handle: 'sample-scope' },
    ]
    const panel = mount(DebugPanel, { props: { session: { ...model.session } } })
    await panel.get('.abele-debug-value_row > .tree-item-self').trigger('click')
    command.mockImplementationOnce(async (...args: unknown[]) => {
      const params = args[1] as { operation_id: string; depth: number }
      inspectionId = params.operation_id
      rpc.mockImplementation(async (method: string) => {
        if (method === 'debugger.v1.approve') {
          completed = true
          return receipt('completed', { operation_id: inspectionId })
        }
        if (method === 'debugger.v1.history')
          return {
            entries: completed
              ? [
                  {
                    actor: { kind: 'human', principal_id: 'sample-human' },
                    operation_id: params.operation_id,
                    operation: 'variables',
                    outcome: 'completed',
                    debug_session_id: 'sample-debug',
                    incarnation: 'sample-incarnation',
                    history_seq: 1,
                    event_seq: 8,
                    stop: null,
                    observed_at: '2025-01-01T00:00:00.000Z',
                    stop_epoch: 3,
                    state_revision: 4,
                    target_id: 'sample-target',
                    build_identity: 'matched',
                    payload_status: 'retained',
                    requested_data: {
                      items: [
                        { name: 'n', value: '3', handle: params.depth > 0 ? 'sample-child' : null },
                      ],
                      truncated: false,
                      start: 0,
                      count: 50,
                      next: null,
                      depth_limit: params.depth,
                      expansion_depth: 0,
                      observation_stop_epoch: 3,
                    },
                  },
                ]
              : [],
            truncated_before: 0,
          } as never
        return { proposals: [], truncated: false, next: null } as never
      })
      return receipt(delayed ? 'pending' : 'completed')
    })
    await model.inspect('sample-scope')
    await panel.setProps({ session: { ...model.session } })
    if (delayed) {
      expect(panel.text()).toContain('Waiting for approval in Debug')
      expect(model.session.variables[0].value).toBe('Waiting for approval in Debug')
      expect(model.session.variables[0].children).toBeUndefined()
      expect(
        rpc.mock.calls.some(
          ([method, params]) =>
            method === 'debugger.v1.approve' && (params as any)?.decision === 'approve'
        )
      ).toBe(false)
      model.addProposal({
        ...proposal,
        key: 'sample-inspection',
        method: 'variables',
        params: command.mock.calls.at(-1)![1],
        receipt: receipt('pending', { operation_id: inspectionId }),
      })
      await model.decide(JSON.stringify([proposal.principal_key, inspectionId]), true)
      // The chat approval handler refreshes history after the explicit decision.
      await model.refreshHistory()
      await panel.setProps({ session: { ...model.session } })
    }
    expect(model.session.variables).toEqual([
      expect.objectContaining({
        name: 'Local',
        children: [expect.objectContaining({ name: 'n', value: '3', handle: 'sample-child' })],
      }),
    ])
    expect(panel.findAll('.abele-debug-value_row')).toHaveLength(2)
    expect(panel.text()).toContain('n')
    await panel
      .findAll('.abele-debug-value_row')[1]
      .get(':scope > .tree-item-self')
      .trigger('click')
    expect(panel.emitted('inspect')?.at(-1)).toEqual(['sample-child'])
    expect(command).toHaveBeenCalledTimes(1)
    panel.unmount()
  }
)

it('removes all breakpoints displayed on a relocated line', async () => {
  const { model, command } = fixture()
  model.observe({
    observation: 'current',
    snapshot: snapshot({
      breakpoints: [
        {
          breakpoint_id: 'sample-first',
          source_id: 'sample-source',
          line: 6,
          resolved_line: 7,
          resolved_column: null,
          message: null,
          status: 'relocated',
        },
        {
          breakpoint_id: 'sample-second',
          source_id: 'sample-source',
          line: 5,
          resolved_line: 7,
          resolved_column: null,
          message: null,
          status: 'relocated',
        },
      ],
    }),
  })
  await model.toggleBreakpoint('sample-source', 7)
  expect(command).toHaveBeenLastCalledWith(
    'breakpoints.patch',
    expect.objectContaining({
      upsert: [],
      remove: ['sample-first', 'sample-second'],
    })
  )
})

it('toggles against the confirmed set when clicks arrive before verification', async () => {
  const { model, command } = fixture()
  command.mockImplementationOnce(async () =>
    receipt('completed', {
      snapshot: snapshot({
        state_revision: 5,
        breakpoint_revision: 3,
        event_seq: 9,
        breakpoints: [
          {
            breakpoint_id: 'sample-first',
            source_id: 'sample-source',
            line: 7,
            resolved_line: 7,
            resolved_column: null,
            message: null,
            status: 'verified',
          },
        ],
      }),
    })
  )
  command.mockImplementationOnce(async () =>
    receipt('completed', {
      snapshot: snapshot({
        state_revision: 6,
        breakpoint_revision: 4,
        event_seq: 10,
      }),
    })
  )
  await Promise.all([
    model.toggleBreakpoint('sample-source', 7),
    model.toggleBreakpoint('sample-source', 7),
  ])
  expect(command).toHaveBeenLastCalledWith(
    'breakpoints.patch',
    expect.objectContaining({
      expected_state_revision: 5,
      expected_breakpoint_revision: 3,
      upsert: [],
      remove: ['sample-first'],
    })
  )
  expect(model.session.breakpoints).toEqual([])
})

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
    if (method === 'debugger.v1.scopes') return { data: { items: [] } }
    if (method === 'debugger.v1.approve')
      return (params as { decision?: string })?.decision === 'deny'
        ? receipt('rejected', { dispatch: 'not_dispatched', code: 'denied' })
        : receipt()
    if (method === 'debugger.v1.approvals') return { proposals: [], truncated: false, next: null }
    return []
  })
  const command = vi.fn(async (_method: string, _params: unknown) => receipt())
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
  it('says in words why breakpoints are refused on a file not proven to be what runs', () => {
    expect(receiptMessage('build_identity_unverified')).toContain('Restart the program')
    expect(receiptMessage('stale_state')).toBe('stale_state')
  })
  it('stops an externally owned target by detaching, never terminating it', async () => {
    const { model, command } = fixture()
    model.observe({
      observation: 'current',
      snapshot: snapshot({ target: { ...snapshot().target, process_ownership: 'external' } }),
    })
    expect(model.session.attached).toBe(true)
    await model.command('stop')
    expect(command).toHaveBeenCalledWith(
      'detach',
      expect.objectContaining({ debug_session_id: 'sample-debug' })
    )
    model.observe({
      observation: 'current',
      snapshot: snapshot({
        lifecycle: 'detached',
        target: { ...snapshot().target, process_ownership: 'external' },
      }),
    })
    expect(model.session).toMatchObject({ status: 'exited', attached: true, detached: true })
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
