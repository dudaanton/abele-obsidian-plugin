import { expect, it, vi } from 'vitest'
import { NodeConnection } from '@/node/NodeService'
import { ChannelError } from '@abele/channel-protocol'

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
  }
  const store = { close: vi.fn() }
  const connection = new NodeConnection(client as never, store as never)
  const oldAttempt = connection.connect()
  const refreshed = connection.refreshAuthorization()
  expect(connection.state.value).toBe('offline')
  finish()
  await oldAttempt
  await refreshed
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
    subscribe: vi.fn(async (stream: string) => { if (stream === 'revoked') throw new ChannelError('unauthorized') }),
    disconnect: vi.fn(async () => {}),
  }
  const state = { cursors: { revoked: 1, healthy: 2 } as Record<string, number> }
  const store = { transaction: vi.fn(async (work: (s: typeof state) => unknown) => work(state)), close: vi.fn() }
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
