import { describe, expect, it, vi } from 'vitest'
import { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'

describe('vendored node repository contract', () => {
  it('acquires independent repository leases from the first wire request', async () => {
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:1/channel', profile: 'local-token-v1', token: 'fixture-token' },
      new NodeClientStore('repository-leases', new IDBFactory())
    )
    const request = vi.spyOn(client, 'request').mockResolvedValue({
      subscription_id: 'sample-lease',
      expires_at: '2030-01-01T00:00:00.000Z',
      refresh_required: false,
    })
    // A sidebar and an open tab acquire before either has an ID to renew.
    await client.repository.watch({ worktree_id: 'sample-worktree', changes: null })
    await client.repository.watch({ worktree_id: 'sample-worktree', changes: null })
    expect(request.mock.calls.map(([, params]) => params)).toEqual([
      { worktree_id: 'sample-worktree', changes: null, explicit_renewal: true },
      { worktree_id: 'sample-worktree', changes: null, explicit_renewal: true },
    ])
  })
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
