import { describe, expect, it, vi } from 'vitest'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { NodeConnection, NodeService } from '@/node/NodeService'
import { NodeClientStore } from '@/node/NodeClientStore'
import { LocalDiscovery } from '@/node/localDiscoveryCore'
import { localNodeRegistrationUrl } from '@/node/localDiscovery'
import { freezeNodePathContext } from '@/node/NodePathOwnerActions'

describe('node path shell fences', () => {
  it('adapts only the protected exact loopback channel to the local registry URL', () => {
    expect(localNodeRegistrationUrl('ws://127.0.0.1:4321/channel')).toBe('http://127.0.0.1:4321')
    expect(() => localNodeRegistrationUrl('ws://localhost:4321/channel')).toThrow()
    expect(() => localNodeRegistrationUrl('ws://127.0.0.1:4321/other')).toThrow()
  })
  it('does not load a native runtime or read an installation token on mobile', async () => {
    const load = vi.fn(() => {
      throw new Error('native runtime must not load')
    })
    const discovery = new LocalDiscovery(false, load)
    expect(discovery.discover('/sample/state')).toBeUndefined()
    await expect(
      discovery.connect(
        { nodeName: 'Sample', nodeId: 'sample-node', endpoint: 'ws://127.0.0.1:1234/channel' },
        'Sample device',
        { add: vi.fn() }
      )
    ).rejects.toThrow('local_discovery_stale')
    expect(load).not.toHaveBeenCalled()
  })
  it('never publishes an unauthenticated candidate to the registry', async () => {
    const client = new NodeClient(
      { profile: 'local-token-v1', url: 'ws://127.0.0.1:1234/channel', token: 'a'.repeat(64) },
      new MemoryClientStore()
    )
    const registry = { addPaired: vi.fn() }
    await expect(
      NodeService.prototype.adoptPaired.call(
        { registry } as never,
        'Sample',
        client,
        {} as NodeClientStore
      )
    ).rejects.toThrow('Authenticated paired admission')
    expect(registry.addPaired).not.toHaveBeenCalled()
  })
  it('turns a destroyed connection offline rather than leaving a connected dot behind', async () => {
    const client = { disconnect: vi.fn(async () => {}) } as unknown as NodeClient
    const store = { close: vi.fn() } as unknown as NodeClientStore
    const connection = new NodeConnection(client, store)
    connection.state.value = 'connected'
    connection.destroy()
    expect(connection.state.value).toBe('offline')
    await Promise.resolve()
    expect(client.disconnect).toHaveBeenCalledOnce()
  })
  it('captures immutable context before opening the destination chat picker', () => {
    const target = {
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      projectId: 'sample-project',
      kind: 'worktree' as const,
      id: 'tree-one',
    }
    const captured = freezeNodePathContext({
      target,
      path: 'sample.ts',
      text: 'quoted bytes',
      revision: { kind: 'commit', commit: 'a'.repeat(40) },
    })
    target.id = 'tree-two'
    expect(captured.target.id).toBe('tree-one')
    expect(Object.isFrozen(captured.target)).toBe(true)
    expect(Object.isFrozen(captured.revision)).toBe(true)
  })
})
