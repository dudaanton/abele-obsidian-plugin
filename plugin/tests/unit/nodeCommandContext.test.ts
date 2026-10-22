import { expect, it, vi } from 'vitest'
import { NodeClient } from '@abele/node-client'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeManagerController } from '@/node/NodeManagerController'
import { ChannelError } from '@abele/channel-protocol'

it('retains the full target folder for a bypass receipt without an approval payload', async () => {
  const f = fixture()
  vi.spyOn(f.client, 'listProjects').mockResolvedValue([
    { project_id: 'sample-project', root_path: '/workspace/sample-project' },
  ] as never)
  vi.spyOn(f.client.repository, 'worktrees').mockResolvedValue({
    entries: [
      {
        worktree_id: 'sample-tree',
        kind: 'root',
        path_label: '/workspace/sample-project',
        branch: 'refs/heads/main',
      },
    ],
  } as never)
  try {
    await f.controller.command(
      'sample-parent',
      { worktree_id: 'sample-tree', command: 'pwd' },
      'sample-operation',
      'bypass',
      'Check the folder.'
    )
    const card = (await f.controller.cards('sample-parent'))[0]
    expect(card.prompts).toEqual([])
    expect(card.folderLabel).toBe('sample-project')
    expect(card.folder).toBe('/workspace/sample-project')
  } finally {
    f.store.close()
  }
})

it('preserves a stopped parent when reconnect recovers an unknown command receipt', async () => {
  const f = fixture()
  const original = f.request.getMockImplementation()!
  let lost = true
  f.request.mockImplementation(async (method, params) => {
    if (method === 'command.context.v1.prepare' && lost) {
      lost = false
      throw new ChannelError('outcome_unknown')
    }
    return original(method, params)
  })
  try {
    await expect(
      f.controller.command(
        'sample-parent',
        { worktree_id: 'sample-tree', command: 'pwd' },
        'sample-operation',
        'ask',
        'Check the folder.'
      )
    ).rejects.toThrow(/outcome_unknown/)
    await f.controller.stopParent('sample-parent')
    await f.client.flush()
    const restored = new NodeManagerController(f.client, f.store)
    await restored.restore()
    expect(await f.store.read((s) => s.managerOperations!['sample-operation'].notified)).toBe(true)
    await f.store.transaction((s) => {
      s.managerOperations!['sample-operation'].run = { ...f.run, state: 'exited', exit_code: 0 }
    })
    const wake = vi.fn(() => true)
    await restored.wakeDelivered(wake)
    expect(wake).not.toHaveBeenCalled()
  } finally {
    f.store.close()
  }
})

it('replaces the unknown placeholder when SDK reconnect replay recovers the preparation receipt', async () => {
  const f = fixture()
  const original = f.request.getMockImplementation()!
  let lost = true
  f.request.mockImplementation(async (method, params) => {
    if (method === 'command.context.v1.prepare' && lost) {
      lost = false
      throw new ChannelError('outcome_unknown')
    }
    return original(method, params)
  })
  try {
    await expect(
      f.controller.command(
        'sample-parent',
        { worktree_id: 'sample-tree', command: 'node --version' },
        'sample-operation',
        'ask',
        'Check the runtime.'
      )
    ).rejects.toThrow(/outcome_unknown/)
    await f.client.flush()
    const restored = new NodeManagerController(f.client, f.store)
    const card = (await restored.cards('sample-parent'))[0]
    expect(card.run.session_id).toBe('sample-stream')
    expect(card.run.state).toBe('pending_approval')
    expect(card.prompts).toHaveLength(1)
    await f.store.transaction((s) => {
      s.managerOperations!['sample-operation'].notified = true
    })
    await restored.restore()
    expect(await f.store.read((s) => s.managerOperations!['sample-operation'].notified)).toBe(false)
    const { approval: _approval, ...update } = f.run
    await f.store.transaction((s) => {
      s.events['sample-stream'] = [
        {
          kind: 'event',
          node_id: 'sample-node',
          stream_id: 'sample-stream',
          actor: { kind: 'node' },
          at: '2028-01-01T00:00:00Z',
          type: 'command.updated',
          seq: 1,
          data: { ...update, state: 'exited', exit_code: 0 },
        },
      ] as never
    })
    const wake = vi.fn(() => true)
    await restored.wakeDelivered(wake)
    await restored.wakeDelivered(wake)
    expect(wake).toHaveBeenCalledTimes(1)
    expect(f.request.mock.calls.some(([method]) => method === 'command.context.v1.execute')).toBe(
      false
    )
  } finally {
    f.store.close()
  }
})

it('keeps a local pre-approval refusal terminal even after the node disconnects', async () => {
  const f = fixture(false)
  try {
    await expect(
      f.controller.command(
        'sample-parent',
        { worktree_id: 'sample-tree', command: 'pwd' },
        'sample-operation',
        'ask',
        'Check the folder.'
      )
    ).rejects.toThrow(/0.4.47/)
    Object.assign(f.client, { channel: undefined })
    const run = await f.controller.mutate(
      'sample-parent',
      'command.v1.cancel',
      { session_id: 'unsubmitted-command', run_id: 'sample-operation' },
      'sample-stop'
    )
    expect(run.state).toBe('failed')
    expect((await f.controller.cards('sample-parent'))[0].prompts).toEqual([])
  } finally {
    f.store.close()
  }
})

it('applies context journal updates which omit the status-only approval field', async () => {
  const f = fixture()
  try {
    await f.controller.command(
      'sample-parent',
      { worktree_id: 'sample-tree', command: 'node --version' },
      'sample-operation',
      'ask',
      'Check the runtime.'
    )
    const { approval: _approval, ...update } = f.run
    await f.store.transaction((s) => {
      s.events['sample-stream'] = [
        {
          kind: 'event',
          node_id: 'sample-node',
          stream_id: 'sample-stream',
          actor: { kind: 'node' },
          at: '2028-01-01T00:00:00Z',
          type: 'command.updated',
          seq: 1,
          data: { ...update, state: 'exited', exit_code: 0 },
        },
      ] as never
    })
    const card = (await f.controller.cards('sample-parent'))[0]
    expect(card.run.state).toBe('exited')
    expect(card.prompts).toEqual([])
  } finally {
    f.store.close()
  }
})

function fixture(supported = true) {
  const store = new NodeClientStore(crypto.randomUUID(), new IDBFactory())
  const client = new NodeClient(
    { url: 'ws://localhost:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    store
  )
  const approval = {
    kind: 'permission',
    prompt_id: 'sample-prompt',
    session_id: 'sample-stream',
    run_id: 'sample-run',
    revision: 1,
    action_digest: 'b'.repeat(64),
    expires_at: Number.MAX_SAFE_INTEGER,
    state: 'pending',
    choice: null,
    installation_id: null,
    delivered: false,
    tool_name: 'command.context.v1.prepare',
    title: 'Command',
    input: { command: 'node --version', cwd: '/workspace/sample-project' },
  }
  const run = {
    run_id: 'sample-run',
    prompt_id: 'sample-prompt',
    session_id: 'sample-stream',
    context_id: 'sample-context',
    permission_mode: 'ask',
    method: 'command.v1.run',
    state: 'pending_approval',
    stdout: '',
    stderr: '',
    stdout_truncated: false,
    stderr_truncated: false,
    approval,
  }
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === 'project.list') return []
    if (method === 'node.describe')
      return {
        capabilities: {
          capabilities: { command_context_v1: { status: supported ? 'supported' : 'unsupported' } },
        },
      }
    if (method === 'command.context.v1.enable') return { enabled: true }
    if (method === 'command.context.v1.create')
      return {
        context_id: 'sample-context',
        parent_chat_id: 'sample-parent',
        stream_id: 'sample-stream',
        worktree_id: 'sample-tree',
      }
    if (method === 'command.context.v1.prepare')
      return {
        ...run,
        permission_mode: params.permission_mode,
        ...(params.permission_mode === 'bypass' ? { state: 'running', approval: null } : {}),
      }
    if (method === 'command.context.v1.status') return run
    if (method === 'command.context.v1.execute')
      return { ...approval, state: 'resolved', choice: params.choice }
    return {}
  })
  Object.assign(client, { channel: { request } })
  vi.spyOn(client, 'subscribe').mockResolvedValue(undefined as never)
  vi.spyOn(client, 'head').mockResolvedValue(0)
  return { store, client, request, run, controller: new NodeManagerController(client, store) }
}

it('creates/reuses a durable context and prepares exactly one Ask card without executing', async () => {
  const f = fixture()
  try {
    const params = {
      worktree_id: 'sample-tree',
      command: 'node --version',
      session_id: 'sample-provider-session',
    }
    await f.controller.command(
      'sample-parent',
      params,
      'sample-operation',
      'ask',
      'Check the runtime.'
    )
    await f.controller.command(
      'sample-parent',
      params,
      'sample-operation',
      'ask',
      'Check the runtime.'
    )
    const cards = await f.controller.cards('sample-parent')
    expect(cards).toHaveLength(1)
    expect(cards[0].prompts).toHaveLength(1)
    expect(
      f.request.mock.calls.filter(([method]) => method === 'command.context.v1.prepare')[0][1]
    ).not.toHaveProperty('session_id')
    expect(f.request.mock.calls.filter(([m]) => m === 'command.context.v1.create')).toHaveLength(1)
    expect(f.request.mock.calls.filter(([m]) => m === 'command.context.v1.prepare')).toHaveLength(1)
    expect(
      f.request.mock.calls.some(
        ([m]) => m === 'command.context.v1.execute' || m === 'session.create'
      )
    ).toBe(false)
    await f.controller.answer('sample-parent', cards[0].prompts[0], 'allow')
    await f.controller.answer('sample-parent', cards[0].prompts[0], 'allow')
    expect(f.request.mock.calls.filter(([m]) => m === 'command.context.v1.execute')).toHaveLength(1)
    await expect(
      f.controller.status('other-parent', 'sample-stream', 'sample-run')
    ).rejects.toThrow(/belong/)
  } finally {
    f.store.close()
  }
})

it('passes bypass explicitly and never creates an approval card', async () => {
  const f = fixture()
  try {
    await f.controller.command(
      'sample-parent',
      { worktree_id: 'sample-tree', command: 'node --version' },
      'sample-operation',
      'bypass',
      'Check the runtime.'
    )
    expect((await f.controller.cards('sample-parent'))[0].prompts).toEqual([])
    expect(
      f.request.mock.calls.find(([m]) => m === 'command.context.v1.prepare')?.[1].permission_mode
    ).toBe('bypass')
  } finally {
    f.store.close()
  }
})

it('names the required update before sending anything on an older node', async () => {
  const f = fixture(false)
  try {
    await expect(
      f.controller.command(
        'sample-parent',
        { worktree_id: 'sample-tree', command: 'pwd' },
        'sample-operation',
        'ask',
        'Check the folder.'
      )
    ).rejects.toThrow(/0.4.47/)
    expect(f.request.mock.calls.map(([m]) => m)).toEqual(['node.describe'])
  } finally {
    f.store.close()
  }
})
it('retains the node resource reason when preparation fails, without executing', async () => {
  const f = fixture()
  const original = f.request.getMockImplementation()!
  f.request.mockImplementation(async (method, params) => {
    if (method === 'command.context.v1.prepare')
      throw new ChannelError('not_found', 'The command worktree no longer exists.', {
        resource: 'worktree',
      })
    return original(method, params)
  })
  try {
    await expect(
      f.controller.command(
        'sample-parent',
        { worktree_id: 'sample-tree', command: 'pwd' },
        'sample-operation',
        'ask',
        'Check the folder.'
      )
    ).rejects.toThrow(/worktree no longer exists/)
    expect(f.request.mock.calls.some(([m]) => m === 'command.context.v1.execute')).toBe(false)
    const cards = await f.controller.cards('sample-parent')
    expect(cards[0].run.state).toBe('failed')
    expect(cards[0].prompts).toHaveLength(0)
    expect(cards[0].run.reason).toContain('worktree no longer exists')
    expect(cards[0].justification).toBe('Check the folder.')
    expect((await f.controller.cards('sample-parent'))[0].run.state).toBe('failed')
    expect(f.request.mock.calls.some(([m]) => m === 'command.context.v1.execute')).toBe(false)
  } finally {
    f.store.close()
  }
})

it('retains preparation identity across a lost reply and a controller restart', async () => {
  const f = fixture()
  const original = f.request.getMockImplementation()!
  let lost = true
  f.request.mockImplementation(async (method, params) => {
    if (method === 'command.context.v1.prepare' && lost) {
      lost = false
      throw new ChannelError('outcome_unknown')
    }
    return original(method, params)
  })
  try {
    const args = { worktree_id: 'sample-tree', command: 'node --version' }
    await expect(
      f.controller.command('sample-parent', args, 'sample-operation', 'ask', 'Check the runtime.')
    ).rejects.toThrow(/outcome_unknown/)
    expect((await f.controller.cards('sample-parent'))[0].run.state).toBe('outcome_unknown')
    const restored = new NodeManagerController(f.client, f.store)
    await restored.command('sample-parent', args, 'sample-operation', 'ask', 'Check the runtime.')
    expect((await restored.cards('sample-parent'))[0].prompts).toHaveLength(1)
    expect(f.request.mock.calls.filter(([m]) => m === 'command.context.v1.create')).toHaveLength(1)
    await expect(
      restored.command('sample-parent', args, 'sample-operation', 'bypass', 'Check the runtime.')
    ).rejects.toThrow(/idempotency_mismatch/)
  } finally {
    f.store.close()
  }
})

it('requires fresh local permission for an owner decision and routes cancel through the context', async () => {
  const f = fixture()
  try {
    await f.controller.command(
      'sample-parent',
      { worktree_id: 'sample-tree', command: 'node --version' },
      'sample-operation',
      'ask',
      'Check the runtime.'
    )
    const prompt = (await f.controller.cards('sample-parent'))[0].prompts[0]
    f.controller.canApprove = async () => false
    await expect(f.controller.answer('sample-parent', prompt, 'allow')).rejects.toThrow(
      /permissions changed/i
    )
    f.controller.canApprove = async () => () => {
      throw new Error('Sample scope revoked before enqueue')
    }
    await expect(f.controller.answer('sample-parent', prompt, 'allow')).rejects.toThrow(
      /revoked before enqueue/
    )
    expect(f.request.mock.calls.some(([m]) => m === 'command.context.v1.execute')).toBe(false)
    const original = f.request.getMockImplementation()!
    f.request.mockImplementation(async (method, params) =>
      method === 'command.context.v1.cancel'
        ? { ...f.run, state: 'cancelled', approval: null }
        : original(method, params)
    )
    await f.controller.mutate(
      'sample-parent',
      'command.v1.cancel',
      { session_id: 'sample-stream', run_id: 'sample-run' },
      'sample-cancel'
    )
    expect(f.request.mock.calls.some(([m]) => m === 'command.context.v1.cancel')).toBe(true)
    expect(f.request.mock.calls.some(([m]) => m === 'command.v1.cancel')).toBe(false)
  } finally {
    f.store.close()
  }
})
