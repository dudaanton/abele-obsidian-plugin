import { describe, expect, it } from 'vitest'
import { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'

describe('vendored node repository contract', () => {
  it('includes the versioned browser repository reads', () => {
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:1/channel', profile: 'local-token-v1', token: 'fixture-token' },
      new NodeClientStore('repository-contract', new IDBFactory())
    )
    expect(client.repository).toBeDefined()
    expect(client.repository.tree).toBeTypeOf('function')
    expect(client.repository.watch).toBeTypeOf('function')
  })
})
