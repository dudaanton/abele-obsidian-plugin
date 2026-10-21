import { expect, it, vi } from 'vitest'
import { NodeManagerController } from '@/node/NodeManagerController'
import type { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'
const receipt = {
  run_id: 'sample-run',
  prompt_id: 'sample-prompt',
  session_id: 'sample-session',
  method: 'command.v1.run',
  state: 'pending_approval',
  stdout: '',
  stderr: '',
  stdout_truncated: false,
  stderr_truncated: false,
}

it('reports a retained developer worktree only after its integration succeeds, without removing it', async () => {
  const f = fixture()
  try {
    await f.store.transaction((state) => {
      state.results['sample-integration'] = { result: { ...receipt, method: 'git.v1.integrate' } }
      state.managerOperations = {
        'sample-integration': {
          parent: 'sample-parent',
          method: 'git.v1.integrate',
          params: {
            project_id: 'sample-project',
            source_worktree_id: 'sample-source',
            source_branch: 'work/sample',
          },
          run: { ...receipt, method: 'git.v1.integrate', state: 'running' } as never,
        },
      }
    })
    expect(await f.controller.cleanupFor('sample-parent', 'sample-run')).toBeUndefined()
    await f.store.transaction((state) => {
      state.managerOperations!['sample-integration'].run!.state = 'applied'
    })
    expect(await f.controller.cleanupFor('sample-parent', 'sample-run')).toMatchObject({
      worktree_id: 'sample-source',
      owner_approval_required: true,
    })
    expect(await f.controller.cleanupFor('other-parent', 'sample-run')).toBeUndefined()
    expect(f.client.request).not.toHaveBeenCalled()
  } finally {
    f.store.close()
  }
})
function fixture(supported = true) {
  const store = new NodeClientStore(crypto.randomUUID(), new IDBFactory())
  const client = {
    connected: true,
    store,
    describe: async () => ({
      capabilities: {
        capabilities: { command_run_v1: { status: supported ? 'supported' : 'unsupported' } },
      },
    }),
    subscribe: vi.fn(async () => {}),
    request: vi.fn(),
    flush: vi.fn(async () =>
      store.transaction((s) => {
        for (const entry of s.outbox)
          s.results[entry.operation_id] = { result: receipt, request: entry }
        s.outbox = []
      })
    ),
  }
  return {
    store,
    client,
    controller: new NodeManagerController(client as unknown as NodeClient, store),
  }
}
it('reads command cards without rewriting the entire node store', async () => {
  const f = fixture()
  const write = vi.spyOn(f.store, 'transaction')
  try {
    expect(await f.controller.cards('sample-parent')).toEqual([])
    expect(write).not.toHaveBeenCalled()
  } finally {
    f.store.close()
  }
})
it('wakes the parent once after a command ends and persists delivery across reload', async () => {
  const f = fixture()
  await f.controller.mutate(
    'sample-parent',
    'command.v1.run',
    {
      session_id: 'sample-session',
      project_id: 'sample-project',
      argv: ['pwd'],
    },
    'sample-operation'
  )
  const wake = vi.fn(() => true)
  await f.controller.wakeDelivered(wake)
  expect(wake).not.toHaveBeenCalled()
  await f.store.transaction((s) => {
    s.managerOperations!['sample-operation'].run = {
      ...receipt,
      state: 'exited',
      exit_code: 0,
    } as never
  })
  await f.controller.wakeDelivered(wake)
  const restored = new NodeManagerController(f.client as never, f.store)
  await restored.wakeDelivered(wake)
  expect(wake).toHaveBeenCalledTimes(1)
  expect((wake.mock.calls[0] as unknown as string[])[1]).not.toContain('sample-run')
  expect(wake.mock.calls[0]).toEqual([
    'sample-parent',
    expect.stringContaining('node_command_status'),
  ])
  f.store.close()
})
it('explains invalid command input before enqueueing rather than exposing raw validation JSON', async () => {
  const f = fixture()
  await expect(
    f.controller.mutate(
      'sample-parent',
      'command.v1.run',
      {
        session_id: 'sample-session',
        project_id: 'sample-project',
        argv: ['pwd'],
        command: 'pwd',
      },
      'sample-operation'
    )
  ).rejects.toThrow(/invalid_params:.*argv.*command/)
  expect(f.client.flush).not.toHaveBeenCalled()
  f.store.close()
})
it('returns an accepted command receipt even when subscribing to its updates is busy', async () => {
  const f = fixture()
  f.client.subscribe.mockRejectedValueOnce(new Error('resource_busy'))
  try {
    expect(
      await f.controller.mutate(
        'sample-parent',
        'command.v1.run',
        {
          session_id: 'sample-session',
          project_id: 'sample-project',
          argv: ['pwd'],
        },
        'sample-operation'
      )
    ).toEqual(receipt)
  } finally {
    f.store.close()
  }
})
it('retains exact operations and never answers owner prompts', async () => {
  const f = fixture()
  const params = {
    session_id: 'sample-session',
    project_id: 'sample-project',
    argv: ['npm', 'test'],
  }
  expect(
    await f.controller.mutate('sample-parent', 'command.v1.run', params, 'sample-operation')
  ).toEqual(receipt)
  await f.controller.mutate('sample-parent', 'command.v1.run', params, 'sample-operation')
  await expect(
    f.controller.mutate(
      'sample-parent',
      'command.v1.run',
      { ...params, argv: ['pwd'] },
      'sample-operation'
    )
  ).rejects.toThrow('idempotency_mismatch')
  expect(f.client.request).not.toHaveBeenCalled()
  f.store.close()
})
it('refuses unsupported commands before queueing', async () => {
  const f = fixture(false)
  await expect(
    f.controller.mutate(
      'sample-parent',
      'command.v1.run',
      { session_id: 'sample-session', project_id: 'sample-project', command: 'pwd' },
      'sample-operation'
    )
  ).rejects.toThrow('unsupported_method')
  expect(f.client.flush).not.toHaveBeenCalled()
  f.store.close()
})
it('projects final unknown outcomes without replaying them', async () => {
  const f = fixture()
  await f.controller.mutate(
    'sample-parent',
    'command.v1.run',
    { session_id: 'sample-session', project_id: 'sample-project', command: 'pwd' },
    'sample-operation'
  )
  await f.store.transaction((s) => {
    s.events['sample-session'] = [
      {
        kind: 'event',
        node_id: 'sample-node',
        stream_id: 'sample-session',
        actor: { kind: 'node' },
        at: '2028-01-01T00:00:00Z',
        type: 'command.updated',
        data: {
          ...receipt,
          state: 'outcome_unknown',
          reason: 'restart',
          stdout: 'retained tail',
          stdout_truncated: true,
        },
        seq: 2,
      },
    ] as never
  })
  expect((await f.controller.cards('sample-parent'))[0].run).toMatchObject({
    state: 'outcome_unknown',
    stdout: 'retained tail',
    stdout_truncated: true,
  })
  f.store.close()
})

it('does not let a slow status response hide a final streamed update', async () => {
  const f = fixture()
  await f.controller.mutate(
    'sample-parent',
    'command.v1.run',
    { session_id: 'sample-session', project_id: 'sample-project', command: 'pwd' },
    'sample-operation'
  )
  f.client.request.mockImplementationOnce(async () => {
    await f.store.transaction((s) => {
      s.cursors['sample-session'] = 1
      s.events['sample-session'] = [
        {
          kind: 'event',
          node_id: 'sample-node',
          stream_id: 'sample-session',
          actor: { kind: 'node' },
          at: '2028-01-01T00:00:00Z',
          type: 'command.updated',
          seq: 1,
          data: { ...receipt, state: 'exited', exit_code: 0, stdout: 'finished' },
        },
      ] as never
    })
    return { ...receipt, state: 'running' }
  })
  await f.controller.status('sample-parent', 'sample-session', 'sample-run')
  expect((await f.controller.cards('sample-parent'))[0].run.state).toBe('exited')
  f.store.close()
})

it('refuses a foreign parent reading or cancelling an owned run', async () => {
  const f = fixture()
  await f.controller.mutate(
    'sample-parent',
    'command.v1.run',
    { session_id: 'sample-session', project_id: 'sample-project', command: 'pwd' },
    'sample-operation'
  )
  await expect(f.controller.status('other-parent', 'sample-session', 'sample-run')).rejects.toThrow(
    'does not belong'
  )
  await expect(
    f.controller.mutate(
      'other-parent',
      'command.v1.cancel',
      { session_id: 'sample-session', run_id: 'sample-run' },
      'other-operation'
    )
  ).rejects.toThrow('does not belong')
  f.store.close()
})

it('bounds live output by the requested byte capacity without splitting Unicode', async () => {
  const f = fixture()
  await f.controller.mutate(
    'sample-parent',
    'command.v1.run',
    {
      session_id: 'sample-session',
      project_id: 'sample-project',
      command: 'pwd',
      output_bytes: 1024,
    },
    'sample-operation'
  )
  await f.store.transaction((s) => {
    s.events['sample-session'] = [
      {
        kind: 'event',
        node_id: 'sample-node',
        stream_id: 'sample-session',
        actor: { kind: 'node' },
        at: '2028-01-01T00:00:00Z',
        type: 'command.output',
        seq: 1,
        data: { run_id: 'sample-run', stream: 'stdout', text: '界'.repeat(1000) },
      },
    ] as never
  })
  const run = (await f.controller.cards('sample-parent'))[0].run
  expect(new TextEncoder().encode(run.stdout).length).toBeLessThanOrEqual(1024)
  expect(run.stdout_truncated).toBe(true)
  expect(run.stdout).not.toContain('�')
  f.store.close()
})

it('does not offer an obsolete approval after a final unknown outcome', async () => {
  const f = fixture()
  await f.controller.mutate(
    'sample-parent',
    'command.v1.run',
    { session_id: 'sample-session', project_id: 'sample-project', command: 'pwd' },
    'sample-operation'
  )
  await f.store.transaction((s) => {
    const event = {
      kind: 'event' as const,
      node_id: 'sample-node',
      stream_id: 'sample-session',
      actor: { kind: 'node' as const },
      at: '2028-01-01T00:00:00Z',
    }
    s.events['sample-session'] = [
      {
        ...event,
        seq: 1,
        type: 'prompt.opened',
        data: {
          kind: 'permission',
          prompt_id: 'sample-prompt',
          session_id: 'sample-session',
          run_id: 'sample-run',
          revision: 1,
          action_digest: 'a'.repeat(64),
          expires_at: Number.MAX_SAFE_INTEGER,
          state: 'pending',
          choice: null,
          installation_id: null,
          delivered: false,
        },
      },
      { ...event, seq: 2, type: 'command.updated', data: { ...receipt, state: 'outcome_unknown' } },
    ]
  })
  expect((await f.controller.cards('sample-parent'))[0].prompts).toEqual([])
  f.store.close()
})

it('recovers a durable command approval beyond the transcript window', async () => {
  const f = fixture()
  const prompt = {
    kind: 'permission',
    prompt_id: 'sample-prompt',
    session_id: 'sample-session',
    run_id: 'sample-run',
    revision: 1,
    action_digest: 'a'.repeat(64),
    expires_at: Number.MAX_SAFE_INTEGER,
    state: 'pending',
    choice: null,
    installation_id: null,
    delivered: false,
  }
  f.client.request.mockResolvedValue(receipt)
  Object.assign(f.client, { prompts: vi.fn(async (_session, after) => (after ? [] : [prompt])) })
  await f.controller.mutate(
    'sample-parent',
    'command.v1.run',
    { session_id: 'sample-session', project_id: 'sample-project', command: 'pwd' },
    'sample-operation'
  )
  await f.controller.restore()
  expect((await f.controller.cards('sample-parent'))[0].prompts).toEqual([prompt])
  f.store.close()
})

it('requires the integration capability and preserves rebase conflicts without replay', async () => {
  const f = fixture()
  const params = {
    session_id: 'sample-session',
    worktree_id: 'sample-target',
    source_worktree_id: 'sample-source',
    target_branch: 'main',
    source_branch: 'work/sample',
    expected_target_head: 'a'.repeat(40),
    expected_source_head: 'b'.repeat(40),
    rebase: true,
  }
  await expect(
    f.controller.mutate('sample-parent', 'git.v1.integrate', params, 'sample-integration')
  ).rejects.toThrow('unsupported_method')
  expect(f.client.flush).not.toHaveBeenCalled()
  Object.assign(f.client, {
    describe: async () => ({
      capabilities: { capabilities: { git_integrate_v1: { status: 'supported' } } },
    }),
  })
  const integration = { ...receipt, method: 'git.v1.integrate' }
  f.client.flush.mockImplementation(async () =>
    f.store.transaction((s) => {
      for (const entry of s.outbox)
        s.results[entry.operation_id] = { result: integration, request: entry }
      s.outbox = []
    })
  )
  await f.controller.mutate('sample-parent', 'git.v1.integrate', params, 'sample-integration')
  f.client.request.mockResolvedValue({
    ...integration,
    state: 'failed',
    reason: 'rebase_conflict',
    conflicting_files: ['src/sample-parser.ts'],
  })
  await f.controller.status('sample-parent', 'sample-session', 'sample-run')
  expect((await f.controller.cards('sample-parent'))[0].run).toMatchObject({
    state: 'failed',
    reason: 'rebase_conflict',
    conflicting_files: ['src/sample-parser.ts'],
  })
  expect(f.client.flush).toHaveBeenCalledTimes(1)
  f.store.close()
})
