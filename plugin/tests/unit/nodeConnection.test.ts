import { expect, it, vi } from 'vitest'
import { NodeConnection, NodeService } from '@/node/NodeService'
import { NodePathService } from '@/node/NodePathService'
import { NodePathModel } from '@/node/NodePathModel'
import { useVault } from '../helpers/testEnv'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { ChannelError } from '@abele/channel-protocol'
import { FrameCodec, LIMITS } from '@abele/channel-protocol'
import { RecordQueue } from '@abele/channel-client'
import { MemoryClientStore, NodeClient } from '@abele/node-client'
import { folderDebugReason } from '@/debugger/folderActions'
import { AgentsService } from '@/agents/AgentsService'
import { ChatService } from '@/ai/ChatService'

it('lets a debugger long poll finish without blocking foreground requests or expiring early', async () => {
  vi.useFakeTimers()
  const client = {
    target: {},
    connected: true,
    disconnect: vi.fn(async () => {}),
    request: vi.fn(async (method: string, params?: { timeout_ms: number }) => {
      if (method === 'debugger.v1.wait')
        await new Promise((resolve) => window.setTimeout(resolve, params!.timeout_ms))
      return { answered: method }
    }),
  }
  const connection = new NodeConnection(client as never, { close() {} } as never)
  try {
    const wait = client.request('debugger.v1.wait', { timeout_ms: 60000 })
    const result = expect(wait).resolves.toEqual({ answered: 'debugger.v1.wait' })
    for (let round = 0; round < 12; round++) {
      await expect(client.request('node.describe')).resolves.toEqual({ answered: 'node.describe' })
      await vi.advanceTimersByTimeAsync(5000)
      expect(connection.activity.slowSince.value).toBe(0)
    }
    await result
    expect(client.disconnect).not.toHaveBeenCalled()
  } finally {
    connection.destroy()
    vi.useRealTimers()
  }
})

it('does no delegation restore on an idle tick and wakes after a mailbox event', async () => {
  const memory = new MemoryClientStore()
  let event!: (event: { type: string; stream_id: string; data: unknown }) => void
  const chats = vi
    .spyOn(ChatService, 'getInstance')
    .mockReturnValue({ getAllSessions: () => [] } as never)
  const connection = new NodeConnection(
    {
      connected: true,
      disconnect: async () => {},
      onEvent: (listener: typeof event) => {
        event = listener
        return () => {}
      },
    } as never,
    {
      transaction: memory.transaction.bind(memory),
      read: memory.transaction.bind(memory),
      close() {},
    } as never
  )
  try {
    await connection.refreshDelegations()
    const restore = vi.spyOn(connection.delegation, 'restore')
    await connection.refreshDelegations(false)
    expect(restore).not.toHaveBeenCalled()
    event({
      type: 'delegation.progress',
      stream_id: 'sample-mailbox',
      data: { delegation_id: 'sample-child' },
    })
    await connection.refreshDelegations(false)
    expect(restore).toHaveBeenCalledOnce()
  } finally {
    connection.destroy()
    chats.mockRestore()
  }
})

it('approves a plain-root command without requiring a broader project grant', async () => {
  const chat = {
    delegationParentId: 'sample-parent',
    getToolMode: () => 'ask',
    overrides: ref({
      nodeScope: [
        {
          kind: 'target',
          node_id: 'sample-node',
          project_id: 'sample-project',
          access: 'run',
          target: { kind: 'workspace', workspace_id: 'sample-root' },
        },
      ],
    }),
  }
  const chats = vi
    .spyOn(ChatService, 'getInstance')
    .mockReturnValue({ getAllSessions: () => [chat] } as never)
  const client = {
    target: { expected_node_id: 'sample-node' },
    disconnect: async () => {},
    getProject: async () => ({ repository_path: null }),
    getWorkspace: vi.fn(async () => ({
      workspace_id: 'sample-root',
      project_id: 'sample-project',
      kind: 'root',
      state: 'ready',
    })),
  }
  const connection = new NodeConnection(client as never, { close() {} } as never)
  vi.spyOn(connection.manager, 'targetFor').mockResolvedValue({ project_id: 'sample-project' })
  const run = { session_id: 'sample-context', run_id: 'sample-run', method: 'command.v1.run' }
  try {
    const guard = await connection.manager.canApprove!('sample-parent', run as never)
    expect(typeof guard).toBe('function')
    client.getWorkspace.mockResolvedValueOnce({
      workspace_id: 'sample-root',
      project_id: 'sample-project',
      kind: 'root',
      state: 'unavailable',
    })
    expect(await connection.manager.canApprove!('sample-parent', run as never)).toBe(false)
    chat.overrides.value.nodeScope[0].access = 'edit'
    expect(await connection.manager.canApprove!('sample-parent', run as never)).toBe(false)
    chat.overrides.value.nodeScope = []
    expect(() => (guard as () => void)()).toThrow()
    expect(await connection.manager.canApprove!('sample-parent', run as never)).toBe(false)
  } finally {
    connection.destroy()
    chats.mockRestore()
  }
})

it('requires Run access and rechecks both worktree scopes for integration approval', async () => {
  const scope = (id: string, access = 'run') => ({
    kind: 'target',
    node_id: 'sample-node',
    project_id: 'sample-project',
    target: { kind: 'worktree', worktree_id: id },
    access,
  })
  const chat = {
    delegationParentId: 'sample-parent',
    getToolMode: () => 'ask',
    overrides: ref({ nodeScope: [scope('sample-tree'), scope('sample-source')] }),
  }
  const chats = vi
    .spyOn(ChatService, 'getInstance')
    .mockReturnValue({ getAllSessions: () => [chat] } as never)
  const client = {
    target: { expected_node_id: 'sample-node' },
    disconnect: async () => {},
    repository: {
      worktrees: async () => ({
        entries: [{ worktree_id: 'sample-tree' }, { worktree_id: 'sample-source' }],
      }),
    },
  }
  const connection = new NodeConnection(client as never, { close() {} } as never)
  vi.spyOn(connection.manager, 'targetFor').mockResolvedValue({ worktree_id: 'sample-tree' })
  const run = {
    session_id: 'sample-stream',
    run_id: 'sample-run',
    method: 'git.v1.integrate',
    approval: { input: { params: { source_worktree_id: 'sample-source' } } },
  }
  try {
    const guard = await connection.manager.canApprove!('sample-parent', run as never)
    expect(typeof guard).toBe('function')
    chat.overrides.value.nodeScope = [scope('sample-tree')]
    expect(() => (guard as () => void)()).toThrow()
    expect(await connection.manager.canApprove!('sample-parent', run as never)).toBe(false)
    chat.overrides.value.nodeScope = [scope('sample-tree', 'edit'), scope('sample-source')]
    expect(await connection.manager.canApprove!('sample-parent', run as never)).toBe(false)
  } finally {
    connection.destroy()
    chats.mockRestore()
  }
})

it('rechecks command approval scope after worktree metadata arrives', async () => {
  const chat = {
    delegationParentId: 'sample-parent',
    getToolMode: () => 'ask',
    overrides: ref({
      nodeScope: [
        {
          kind: 'target',
          node_id: 'sample-node',
          project_id: 'sample-project',
          target: { kind: 'worktree', worktree_id: 'sample-tree' },
          access: 'read',
        },
      ],
    }),
  }
  const chats = vi
    .spyOn(ChatService, 'getInstance')
    .mockReturnValue({ getAllSessions: () => [chat] } as never)
  const client = {
    target: { expected_node_id: 'sample-node' },
    disconnect: async () => {},
    repository: {
      worktrees: async () => {
        chat.overrides.value.nodeScope = []
        return { entries: [{ worktree_id: 'sample-tree' }] }
      },
    },
  }
  const connection = new NodeConnection(client as never, { close() {} } as never)
  vi.spyOn(connection.manager, 'targetFor').mockResolvedValue({ worktree_id: 'sample-tree' })
  try {
    await expect(
      connection.manager.canApprove!('sample-parent', {
        session_id: 'sample-stream',
        run_id: 'sample-run',
      } as never)
    ).resolves.toBe(false)
  } finally {
    chats.mockRestore()
    connection.destroy()
  }
})

vi.mock('@/debugger/register', () => ({}))
it('negotiates policy for an already authenticated connection before background reads', async () => {
  const memory = new MemoryClientStore()
  const events: string[] = []
  const client = {
    connected: true,
    target: {},
    describe: vi.fn(async () => ({
      capabilities: { capabilities: { 'execution.policy.v1': { status: 'supported' } } },
    })),
    request: async () => {
      events.push('enable')
      return { enabled: true }
    },
    check: async () => {
      events.push('health')
    },
    disconnect: async () => {},
  }
  const connection = new NodeConnection(
    client as never,
    { transaction: memory.transaction.bind(memory), close() {} } as never
  )
  const refresh = vi.spyOn(connection, 'refreshDelegations').mockImplementation(async () => {
    events.push('read')
  })
  try {
    connection.start()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(events[0]).toBe('enable')
    expect(events.indexOf('read')).toBeGreaterThan(events.indexOf('enable'))
  } finally {
    connection.destroy()
  }
})
it.each([false, true])(
  'runs the SDK admission hook before replay and closes failed admission (%s)',
  async (refuse) => {
    const store = new MemoryClientStore()
    await store.transaction((s) => {
      s.cursors['sample-stream'] = 0
    })
    const queue = new RecordQueue()
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:12345/channel', profile: 'local-token-v1', token: 'sample-token' },
      store,
      {
        connect: async () => ({
          authority: { installation_id: 'sample-installation', profile: 'local-token-v1' },
          welcome: { node_id: 'sample-node', instance_id: 'sample-instance', limits: LIMITS },
          transport: {
            receive: () => queue,
            send: async () => {},
            close: async () => {
              queue.end()
            },
          },
        }),
      } as never
    )
    const events: string[] = []
    vi.spyOn(client, 'subscribe').mockImplementation(async () => {
      events.push('replay')
    })
    vi.spyOn(client, 'flush').mockImplementation(async () => {
      events.push('flush')
    })
    try {
      const connecting = client.connect(async () => {
        events.push('enable')
        if (refuse) throw Error('sample admission refused')
      })
      if (refuse) {
        await expect(connecting).rejects.toThrow('sample admission refused')
        expect(client.connected).toBe(false)
        expect(events).toEqual(['enable'])
      } else {
        await connecting
        expect(events).toEqual(['enable', 'replay', 'flush'])
      }
    } finally {
      await client.disconnect()
    }
  }
)
it('enables execution policy before replay on every connection and skips older peers', async () => {
  const events: string[] = []
  let supported = true
  const client = {
    connected: false,
    target: {},
    describe: vi.fn(async () => {
      events.push('describe')
      return {
        capabilities: {
          capabilities: supported
            ? {
                'execution.policy.v1': { status: 'supported' },
                command_context_v1: { status: 'supported' },
                integration_context_v1: { status: 'supported' },
              }
            : {},
        },
      }
    }),
    request: vi.fn(async (method: string) => {
      events.push(
        method === 'command.context.v1.enable'
          ? 'context'
          : method === 'integration.context.v1.enable'
            ? 'integration'
            : 'enable'
      )
      return { enabled: true }
    }),
    connect: vi.fn(async (admit?: () => Promise<void>) => {
      client.connected = true
      await admit?.()
      events.push('replay')
    }),
    disconnect: vi.fn(async () => {
      client.connected = false
    }),
  }
  const request = client.request
  const connection = new NodeConnection(client as never, { close() {} } as never)
  try {
    await connection.connect()
    expect(events.indexOf('enable')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('enable')).toBeLessThan(events.indexOf('replay'))
    expect(request).toHaveBeenCalledWith('execution.policy.v1.enable', {})
    expect(request).toHaveBeenCalledWith('command.context.v1.enable', {})
    expect(request).toHaveBeenCalledWith('integration.context.v1.enable', {})
    expect(events.indexOf('integration')).toBeLessThan(events.indexOf('replay'))
    expect(events.indexOf('context')).toBeLessThan(events.indexOf('replay'))
    expect(events.filter((e) => e === 'describe').length).toBeGreaterThan(1)
    events.length = 0
    client.connected = false
    await connection.connect()
    expect(events.indexOf('enable')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('enable')).toBeLessThan(events.indexOf('replay'))
    expect(events.filter((e) => e === 'context')).toHaveLength(1)
    expect(events.filter((e) => e === 'integration')).toHaveLength(1)
    expect(events.indexOf('context')).toBeLessThan(events.indexOf('replay'))
    client.connected = false
    supported = false
    request.mockClear()
    await connection.connect()
    expect(request).not.toHaveBeenCalled()
  } finally {
    connection.destroy()
  }
})
it('keeps a live connection after one operation has an uncertain outcome', async () => {
  const client = {
    connected: true,
    request: vi.fn(async (_method: string, _params: unknown) => {
      throw new ChannelError('outcome_unknown')
    }),
    disconnect: vi.fn(async () => {}),
  }
  const connection = new NodeConnection(client as never, { close() {} } as never)
  connection.state.value = 'connected'
  try {
    const request = client.request('repository.diff', {})
    await expect(request).rejects.toThrow(/request may have completed/)
    await expect(request).rejects.toThrow(/^outcome_unknown:/)
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(connection.state.value).toBe('connected')
  } finally {
    connection.destroy()
  }
})
it('publishes token-node attention using the identity learned at admission', async () => {
  const memory = new MemoryClientStore()
  await memory.transaction((s) => {
    s.node_id = 'sample-node'
  })
  const setDelegations = vi.fn()
  const agents = vi.spyOn(AgentsService, 'getInstance').mockReturnValue({ setDelegations } as never)
  const chats = vi
    .spyOn(ChatService, 'getInstance')
    .mockReturnValue({ getAllSessions: () => [] } as never)
  const client = { connected: true, target: {}, disconnect: async () => {} }
  const connection = new NodeConnection(
    client as never,
    {
      transaction: memory.transaction.bind(memory),
      read: memory.transaction.bind(memory),
      close() {},
    } as never
  )
  try {
    await connection.refreshDelegations()
    expect(setDelegations).toHaveBeenCalledWith('sample-node', {})
  } finally {
    connection.destroy()
    agents.mockRestore()
    chats.mockRestore()
  }
})

it('settles a folder menu on a silent transport and describes the replacement peer', async () => {
  vi.useFakeTimers()
  let silent = false
  let instance = 0
  const described: number[] = []
  const connector = {
    async connect() {
      const current = ++instance
      const queue = new RecordQueue()
      return {
        authority: { installation_id: 'sample-installation', profile: 'local-token-v1' },
        welcome: {
          node_id: 'sample-node',
          instance_id: `sample-instance-${current}`,
          limits: LIMITS,
        },
        transport: {
          receive: () => queue,
          async close() {
            queue.end()
          },
          async send(bytes: Uint8Array) {
            const frame = FrameCodec.decode(bytes)
            if (silent) return
            if (frame.kind === 'request') {
              if (frame.method === 'node.describe') described.push(current)
              queue.push(
                FrameCodec.encode({
                  kind: 'response',
                  request_id: frame.request_id,
                  result: { capabilities: { capabilities: {} } },
                })
              )
            } else if (frame.kind === 'ping') queue.push(FrameCodec.encode({ kind: 'pong' }))
          },
        },
      }
    },
  }
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:12345/channel', profile: 'local-token-v1', token: 'sample-token' },
    new MemoryClientStore(),
    connector as never
  )
  const connection = new NodeConnection(client, { close() {} } as never)
  vi.spyOn(connection, 'refreshDelegations').mockResolvedValue()
  try {
    await connection.connect()
    connection.start()
    await Promise.resolve()
    silent = true
    const reason = folderDebugReason({ connection } as never)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await reason).toMatch(/no answer from the node/i)
    expect(connection.state.value).toBe('offline')
    silent = false
    await vi.advanceTimersByTimeAsync(4000)
    expect(connection.state.value).toBe('connected')
    expect(instance).toBe(2)
    expect(described).toContain(2)
  } finally {
    connection.destroy()
    await client.disconnect()
    vi.useRealTimers()
  }
})

it('bounds a silent peer and reconnects despite stalled delegation restore', async () => {
  vi.useFakeTimers()
  let silent = true
  const client = {
    connected: true,
    request: vi.fn(async (..._args: unknown[]) => (silent ? new Promise<unknown>(() => {}) : {})),
    describe() {
      return this.request('node.describe', {})
    },
    connect: vi.fn(async () => {
      client.connected = true
    }),
    disconnect: vi.fn(async () => {
      client.connected = false
    }),
  }
  const connection = new NodeConnection(client as never, { close() {} } as never)
  vi.spyOn(connection, 'refreshDelegations').mockImplementation(() => new Promise(() => {}))
  try {
    connection.start()
    const failed = expect(connection.client.describe()).rejects.toThrow(/no answer from the node/i)
    await vi.advanceTimersByTimeAsync(10000)
    await failed
    expect(connection.state.value).toBe('offline')
    silent = false
    await vi.advanceTimersByTimeAsync(2000)
    expect(client.connect).toHaveBeenCalled()
    expect(connection.state.value).toBe('connected')
  } finally {
    connection.destroy()
    vi.useRealTimers()
  }
})

it('refreshes paired authorization without stranding an open presenter or accepting a late old transport', async () => {
  let finish!: () => void
  const client = {
    connected: false,
    connect: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    ),
    disconnect: vi.fn(async () => {}),
    describe: vi.fn(async () => ({})),
  }
  const store = { close: vi.fn() }
  const connection = new NodeConnection(client as never, store as never)
  const oldAttempt = connection.connect()
  const refreshed = connection.refreshAuthorization()
  expect(connection.state.value).toBe('offline')
  finish()
  await oldAttempt
  await refreshed
  expect(client.describe).not.toHaveBeenCalled()
  expect(client.disconnect).toHaveBeenCalledTimes(2)
  expect(store.close).not.toHaveBeenCalled()
  expect(connection.client).toBe(client)
  client.connect.mockImplementation(async () => {})
  await connection.connect()
  expect(connection.state.value).toBe('connected')
  connection.destroy()
})

it('keeps an admitted node usable when a previously cached mailbox is revoked', async () => {
  const client = {
    connected: false,
    connect: vi.fn(async () => {
      client.connected = true
      throw new ChannelError('unauthorized')
    }),
    flush: vi.fn(async () => {}),
    subscribe: vi.fn(async (stream: string) => {
      if (stream === 'revoked') throw new ChannelError('unauthorized')
    }),
    disconnect: vi.fn(async () => {}),
  }
  const state = { cursors: { revoked: 1, healthy: 2 } as Record<string, number> }
  const store = {
    transaction: vi.fn(async (work: (s: typeof state) => unknown) => work(state)),
    close: vi.fn(),
  }
  const connection = new NodeConnection(client as never, store as never)
  await connection.connect()
  expect(connection.state.value).toBe('connected')
  expect(connection.error.value).toMatch(/saved.*stream/i)
  expect(client.flush).toHaveBeenCalledTimes(1)
  expect(client.subscribe).toHaveBeenCalledWith('healthy')
  expect(state.cursors).toEqual({ healthy: 2 })
  connection.destroy()
})

it('does not overwrite refreshed authorization with a late old admission failure', async () => {
  let fail!: (error: Error) => void
  const client = {
    connected: false,
    connect: vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject
        })
    ),
    disconnect: vi.fn(async () => {}),
  }
  const store = { close: vi.fn() }
  const connection = new NodeConnection(client as never, store as never)
  const pending = connection.connect()
  const refreshed = connection.refreshAuthorization()
  fail(new Error('old revoked key'))
  await expect(pending).rejects.toThrow('old revoked key')
  await refreshed
  expect(connection.error.value).toBe('')
  client.connect.mockImplementation(async () => {})
  await connection.connect()
  expect(connection.state.value).toBe('connected')
  expect(connection.client).toBe(client)
  connection.destroy()
})

it('clears an old reconnect error when an admitted socket recovers', async () => {
  const memory = new MemoryClientStore()
  const client = { connected: true, describe: async () => ({}), disconnect: async () => {} }
  const connection = new NodeConnection(
    client as never,
    { transaction: memory.transaction.bind(memory), close() {} } as never
  )
  try {
    connection.error.value = 'No answer from the node. Reconnecting'
    await connection.connect()
    expect(connection.state.value).toBe('connected')
    expect(connection.error.value).toBe('')
    expect(connection.healthEpoch.value).toBeGreaterThan(0)
  } finally {
    connection.destroy()
  }
})

it('retires a panel connection banner after a health probe without reloading the folder', async () => {
  useVault([])
  NodePathService.destroyCurrent()
  const connection = {
    state: ref('connected'),
    healthEpoch: ref(0),
    client: {},
    connect: async () => {},
  }
  const service = vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: ref([{ id: 'sample-registration', expectedNodeId: 'sample-node' }]),
    connection: () => connection,
  } as never)
  const start = vi.spyOn(NodePathModel.prototype, 'start').mockResolvedValue()
  const reconnect = vi.spyOn(NodePathModel.prototype, 'reconnected').mockResolvedValue()
  try {
    const paths = NodePathService.getInstance()
    const model = paths.model('sample-registration')
    await paths.ready('sample-registration')
    model.report(new ChannelError('outcome_unknown', 'No answer from the node. Reconnecting'))
    ++connection.healthEpoch.value
    await flushPromises()
    expect(model.error.value).toBe('')
    expect(reconnect).not.toHaveBeenCalled()
    model.report(new Error('Sample action failed'))
    ++connection.healthEpoch.value
    await flushPromises()
    expect(model.error.value).toBe('Sample action failed')
  } finally {
    NodePathService.destroyCurrent()
    reconnect.mockRestore()
    start.mockRestore()
    service.mockRestore()
  }
})

it('shares concurrent capability refreshes on an already admitted connection', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const client = {
    connected: true,
    describe: vi.fn(async () => {
      await pending
      return {}
    }),
    disconnect: async () => {},
  }
  const connection = new NodeConnection(client as never, { close() {} } as never)
  try {
    const first = connection.connect()
    const second = connection.connect()
    expect(second).toBe(first)
    expect(client.describe).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])
    // Initial policy discovery plus the fresh capability response, shared by both callers.
    expect(client.describe).toHaveBeenCalledTimes(2)
    await connection.connect()
    expect(client.describe).toHaveBeenCalledTimes(2)
  } finally {
    release()
    connection.destroy()
  }
})

it('keeps a connection banner until an already admitted peer answers again', async () => {
  const memory = new MemoryClientStore()
  const client = {
    connected: true,
    describe: vi.fn(async () => ({})),
    disconnect: async () => {},
  }
  const connection = new NodeConnection(
    client as never,
    { transaction: memory.transaction.bind(memory), close() {} } as never
  )
  try {
    await connection.connect()
    const epoch = connection.healthEpoch.value
    connection.error.value = 'No answer from the node. Reconnecting'
    client.describe.mockRejectedValueOnce(new ChannelError('outcome_unknown'))
    await expect(connection.connect()).rejects.toThrow()
    expect(connection.healthEpoch.value).toBe(epoch)
    expect(connection.error.value).toContain('No answer from the node')
    await connection.connect()
    expect(connection.error.value).toBe('')
    expect(connection.healthEpoch.value).toBeGreaterThan(epoch)
  } finally {
    connection.destroy()
  }
})
