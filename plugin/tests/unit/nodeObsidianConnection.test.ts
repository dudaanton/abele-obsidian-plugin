import { expect, it, vi } from 'vitest'
import { NodeConnection } from '@/node/NodeService'
import { NodeObsidianTools } from '@/node/NodeObsidianTools'

const host = vi.hoisted(() => ({
  changed: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
}))
vi.mock('@/node/NodeObsidianTools', () => ({
  NodeObsidianTools: vi.fn(
    class {
      connectionChanged = host.changed
      destroy = host.destroy
    }
  ),
}))

it('creates the Obsidian host after capability admission and reuses it on an admitted transport', async () => {
  const description = { providers: [] }
  const client = {
    connected: false,
    channel: { channel: { welcome: { methods: [] as string[] } } },
    describe: vi.fn(async () => description),
    connect: vi.fn(async () => {
      client.connected = true
      client.channel.channel.welcome.methods = ['obsidian.tools.v1.advertise']
    }),
    disconnect: vi.fn(async () => {}),
  }
  const store = { close: vi.fn() }
  const connection = new NodeConnection(client as never, store as never, {
    nodeId: 'sample-node',
    label: 'Sample node',
  })
  try {
    expect(NodeObsidianTools).not.toHaveBeenCalled()
    await connection.connect()
    expect(NodeObsidianTools).toHaveBeenCalledExactlyOnceWith(
      client,
      store,
      'sample-node',
      'Sample node'
    )
    expect(host.changed).toHaveBeenCalledWith(description)
    expect(connection.delegation.obsidianSnapshot).toBeTypeOf('function')
    const admitted = connection.obsidian
    await connection.connect()
    expect(connection.obsidian).toBe(admitted)
    expect(NodeObsidianTools).toHaveBeenCalledTimes(1)
  } finally {
    connection.destroy()
  }
})
