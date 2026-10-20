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
