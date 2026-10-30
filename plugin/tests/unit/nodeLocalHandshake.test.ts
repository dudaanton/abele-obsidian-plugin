import { expect, it, vi } from 'vitest'
import { LocalChannelConnector } from '@abele/channel-client'
import { MemoryClientStore, NodeClient } from '@abele/node-client'

it.each([false, true])(
  'does not disclose the local token to an unverified listener (saved identity: %s)',
  async (saved) => {
    const store = new MemoryClientStore()
    if (saved)
      await store.transaction((state) => {
        state.node_id = 'sample-node'
        state.installation_id = 'sample-installation'
      })
    const token = 'a'.repeat(64)
    const sent: Uint8Array[] = []
    const close = vi.fn(async () => {})
    // Use the shipped connector, not a mocked successful admission.
    const connector = new LocalChannelConnector(async () => ({
      send: async (bytes) => {
        sent.push(bytes)
      },
      receive: async function* () {},
      close,
    }))
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token },
      store,
      connector
    )
    try {
      await expect(client.connect()).rejects.toThrow()
      const records = sent.map((bytes) => new TextDecoder().decode(bytes))
      expect(records.join('\n')).not.toContain(token)
      expect(records.map((record) => JSON.parse(record).kind)).toEqual(['local.begin'])
      expect(close).toHaveBeenCalled()
      expect(client.connected).toBe(false)
      expect(await store.transaction((state) => state.node_id)).toBe(
        saved ? 'sample-node' : undefined
      )
    } finally {
      await client.disconnect()
    }
  }
)
