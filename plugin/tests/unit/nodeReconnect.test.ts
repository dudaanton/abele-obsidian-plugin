import { afterEach, expect, it, vi } from 'vitest'
import { NodeConnection } from '@/node/NodeService'
import { ChannelError, FrameCodec, LIMITS } from '@abele/channel-protocol'
import { RecordQueue } from '@abele/channel-client'
import { MemoryClientStore, NodeClient } from '@abele/node-client'
import { createNodeAgentTools } from '@/ai/tools/node/agent'
import { setup } from '../helpers/nodeAgentFixture'

const connections: NodeConnection[] = []
afterEach(() => {
  connections.splice(0).forEach((connection) => connection.destroy())
  vi.useRealTimers()
})

function transport() {
  const client = {
    connected: false,
    connect: vi.fn(async () => {
      client.connected = true
    }),
    disconnect: vi.fn(async () => {
      client.connected = false
    }),
    request: vi.fn(async (_method: string, _params?: unknown): Promise<unknown> => ({})),
    describe() {
      return this.request('node.describe')
    },
  }
  const request = client.request
  const connection = new NodeConnection(client as never, { close() {} } as never)
  connections.push(connection)
  vi.spyOn(connection, 'refreshDelegations').mockResolvedValue()
  return { client, connection, request }
}

it('keeps retrying with growing capped pauses, then recovers without a panel', async () => {
  vi.useFakeTimers()
  const { client, connection } = transport()
  client.connect.mockRejectedValue(new ChannelError('disconnected'))
  connection.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(client.connect).toHaveBeenCalledTimes(1)
  expect(connection.state.value).toBe('connecting')
  await vi.advanceTimersByTimeAsync(2000)
  expect(client.connect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(2000)
  expect(client.connect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(2000)
  expect(client.connect).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(120000)
  expect(client.connect.mock.calls.length).toBeGreaterThan(5)
  client.connect.mockImplementation(async () => {
    client.connected = true
  })
  await vi.advanceTimersByTimeAsync(30000)
  expect(connection.state.value).toBe('connected')
  connection.destroy()
  const count = client.connect.mock.calls.length
  await vi.advanceTimersByTimeAsync(60000)
  expect(client.connect).toHaveBeenCalledTimes(count)
})

it('does not let a synchronous health-probe failure kill the retry lifetime', async () => {
  vi.useFakeTimers()
  const { client, connection } = transport()
  await connection.connect()
  client.describe = () => {
    throw new ChannelError('disconnected')
  }
  connection.start()
  await vi.advanceTimersByTimeAsync(0)
  client.connected = false
  client.describe = () => client.request('node.describe')
  await vi.advanceTimersByTimeAsync(4000)
  expect(client.connect).toHaveBeenCalledTimes(2)
  expect(connection.state.value).toBe('connected')
})

function toolFixture() {
  const f = setup()
  const { client, connection } = transport()
  const original = f.host.connection
  f.host.connection = (...args) => ({
    ...original(...args),
    client: f.client as never,
    waitUntilConnected: (signal?: AbortSignal) => connection.waitUntilConnected(signal),
  })
  // Keep the fixture SDK methods, but reflect the transport's admission state.
  Object.defineProperty(f.client, 'connected', { get: () => client.connected, configurable: true })
  const tools = createNodeAgentTools(() => f.host)
  const call = (signal?: AbortSignal) =>
    tools
      .find((tool) => tool.name === 'node_read')!
      .execute(
        'sample-call',
        {
          node: 'sample-node',
          project: 'sample-project',
          workspace: 'sample-workspace',
          target_kind: 'workspace',
          path: 'sample.txt',
        },
        signal,
        { session: f.session, approved: false, interactive: true }
      )
  return { ...f, client, connection, call }
}

it('waits for reconnect before sending a node tool read', async () => {
  vi.useFakeTimers()
  const f = toolFixture()
  f.client.connect.mockRejectedValueOnce(new ChannelError('disconnected'))
  const pending = f.call()
  void pending.catch(() => {})
  await vi.advanceTimersByTimeAsync(0)
  expect(f.host.connection('sample-node').client.readFile).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(2000)
  expect((await pending).content[0].text).toContain('old')
})

it('returns the existing offline refusal only after a bounded wait; retries continue', async () => {
  vi.useFakeTimers()
  const f = toolFixture()
  f.client.connect.mockRejectedValue(new ChannelError('disconnected'))
  let settled = false
  const failure = f
    .call()
    .catch((error: unknown) => error)
    .finally(() => {
      settled = true
    })
  await vi.advanceTimersByTimeAsync(29999)
  expect(settled).toBe(false)
  expect(f.host.connection('sample-node').client.readFile).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(await failure).toMatchObject({ refusal: { kind: 'offline', node_id: 'sample-node' } })
  const attempts = f.client.connect.mock.calls.length
  await vi.advanceTimersByTimeAsync(30000)
  expect(f.client.connect.mock.calls.length).toBeGreaterThan(attempts)
})

it('does not dispatch when the transport opened but admission did not finish before timeout', async () => {
  vi.useFakeTimers()
  const f = toolFixture()
  f.client.connected = true
  vi.spyOn(f.connection, 'waitUntilConnected').mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(false), 30000))
  )
  const failure = f.call().catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(30000)
  expect(await failure).toMatchObject({ refusal: { kind: 'offline' } })
  expect(f.host.connection('sample-node').client.readFile).not.toHaveBeenCalled()
})

it('cancels a waiting tool without sending it', async () => {
  vi.useFakeTimers()
  const f = toolFixture()
  f.client.connect.mockRejectedValue(new ChannelError('disconnected'))
  const abort = new AbortController()
  const failure = f.call(abort.signal).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(0)
  abort.abort()
  expect(await failure).toMatchObject({ name: 'AbortError' })
  expect(f.host.connection('sample-node').client.readFile).not.toHaveBeenCalled()
})

it('never replays a request already sent when the connection drops', async () => {
  vi.useFakeTimers()
  const { client, connection, request } = transport()
  await connection.connect()
  connection.start()
  request.mockRejectedValueOnce(new ChannelError('disconnected'))
  await expect(
    client.request('file.v1.write', { operation_id: 'sample-operation' })
  ).rejects.toThrow(/may have completed/i)
  await vi.advanceTimersByTimeAsync(4000)
  expect(request.mock.calls.filter(([method]) => method === 'file.v1.write')).toHaveLength(1)
  expect(connection.state.value).toBe('connected')
})

it('rechecks scope after recovery before sending the waiting tool', async () => {
  vi.useFakeTimers()
  const f = toolFixture()
  f.client.connect.mockRejectedValueOnce(new ChannelError('disconnected'))
  const failure = f.call().catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(0)
  f.session.overrides.value.nodeScope = []
  await vi.advanceTimersByTimeAsync(2000)
  expect(await failure).toBeInstanceOf(Error)
  expect(f.host.connection('sample-node').client.readFile).not.toHaveBeenCalled()
})

it('settles waiters and stops retries when the registration is destroyed', async () => {
  vi.useFakeTimers()
  const { client, connection } = transport()
  client.connect.mockRejectedValue(new ChannelError('disconnected'))
  const pending = connection.waitUntilConnected()
  await vi.advanceTimersByTimeAsync(0)
  connection.destroy()
  await expect(pending).resolves.toBe(false)
  const calls = client.connect.mock.calls.length
  await vi.advanceTimersByTimeAsync(60000)
  expect(client.connect).toHaveBeenCalledTimes(calls)
})

it('recovers an SDK transport dropped mid-request and runs the next tool after admission', async () => {
  vi.useFakeTimers()
  const f = setup()
  let queue!: RecordQueue
  let connectionsMade = 0
  let drop = false
  const sent: string[] = []
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:12345/channel', profile: 'local-token-v1', token: 'sample-token' },
    new MemoryClientStore(),
    {
      connect: async () => {
        const current = new RecordQueue()
        queue = current
        connectionsMade++
        return {
          authority: { installation_id: 'sample-installation' },
          welcome: {
            node_id: 'sample-node',
            instance_id: `sample-instance-${connectionsMade}`,
            limits: LIMITS,
          },
          transport: {
            receive: () => current,
            close: async () => {
              current.end()
            },
            send: async (bytes: Uint8Array) => {
              const frame = FrameCodec.decode(bytes)
              if (frame.kind === 'ping') current.push(FrameCodec.encode({ kind: 'pong' }))
              if (frame.kind !== 'request') return
              sent.push(frame.method)
              if (drop) {
                drop = false
                current.end()
                return
              }
              current.push(
                FrameCodec.encode({
                  kind: 'response',
                  request_id: frame.request_id,
                  result: { capabilities: { capabilities: {} } },
                })
              )
            },
          },
        }
      },
    } as never
  )
  const connection = new NodeConnection(client, { close() {} } as never)
  connections.push(connection)
  vi.spyOn(connection, 'refreshDelegations').mockResolvedValue()
  try {
    await connection.connect()
    connection.start()
    await vi.advanceTimersByTimeAsync(0)
    drop = true
    const interrupted = client
      .request('sample.write', { operation_id: 'sample-operation' })
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    // The SDK marks a sent request as uncertain when the wire closes before its response.
    expect(await interrupted).toMatchObject({ code: 'outcome_unknown' })
    const original = f.host.connection
    Object.defineProperty(f.client, 'connected', { get: () => client.connected })
    f.host.connection = (...args) => ({
      ...original(...args),
      waitUntilConnected: (signal) => connection.waitUntilConnected(signal),
    })
    const tool = createNodeAgentTools(() => f.host).find((tool) => tool.name === 'node_folders')!
    const pending = tool.execute('sample-call', { node: 'sample-node' }, undefined, {
      session: f.session,
      approved: false,
      interactive: true,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.client.listProjects).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect((await pending).content[0].text).toContain('sample-project')
    expect(connectionsMade).toBe(2)
    expect(sent.filter((method) => method === 'sample.write')).toHaveLength(1)
  } finally {
    queue.end()
    connection.destroy()
    await client.disconnect()
  }
})
