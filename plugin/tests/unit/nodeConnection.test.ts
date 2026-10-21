import { expect, it, vi } from 'vitest'
import { NodeConnection } from '@/node/NodeService'
import { ChannelError } from '@abele/channel-protocol'
import { FrameCodec, LIMITS } from '@abele/channel-protocol'
import { RecordQueue } from '@abele/channel-client'
import { MemoryClientStore, NodeClient } from '@abele/node-client'
import { folderDebugReason } from '@/debugger/folderActions'
import { AgentsService } from '@/agents/AgentsService'
import { ChatService } from '@/ai/ChatService'

vi.mock('@/debugger/register', () => ({}))
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
    { transaction: memory.transaction.bind(memory), close() {} } as never
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
