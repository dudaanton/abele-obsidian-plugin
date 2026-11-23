import { expect, it, vi } from 'vitest'
import { NodeRegistry, type PairedNode } from '@/node/NodeRegistry'
import { nodeRegistryStorage } from '@/node/nodeRegistryStorage'

const node: PairedNode = {
  id: 'sample-registration',
  label: 'Sample node',
  expectedNodeId: 'sample-node',
  url: 'wss://sample.example.ts.net/channel',
  profile: 'paired-wss-v1',
  installationId: 'sample-installation',
  nodeFingerprint: 'a'.repeat(64),
  publicKey: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) },
}

function setup() {
  const data = new Map<string, unknown>()
  let quotaFull = false
  const local = {
    loadLocalStorage: (key: string) => structuredClone(data.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      if (!quotaFull) data.set(key, structuredClone(value))
    },
  }
  const host = {
    ...nodeRegistryStorage(local),
    getSecret: () => '',
    setSecret: vi.fn(),
    removeSecret: vi.fn(),
  }
  return {
    host,
    fill: () => {
      quotaFull = true
    },
    free: () => {
      quotaFull = false
    },
  }
}

it('rejects a silently lost paired registration and permits retry after freeing storage', () => {
  const f = setup()
  const registry = new NodeRegistry(f.host)
  f.fill()
  expect(() => registry.addPaired(node)).toThrow()
  expect(registry.list()).toEqual([])
  expect(new NodeRegistry(f.host).list()).toEqual([])
  f.free()
  registry.addPaired(node)
  expect(new NodeRegistry(f.host).list()).toEqual([node])
})

it('preserves the previous registration and authority when replacement or removal does not stick', () => {
  const f = setup()
  const registry = new NodeRegistry(f.host)
  registry.addPaired(node)
  const authority = registry.authorizationId(node.id)
  f.fill()
  expect(() => registry.addPaired({ ...node, label: 'Updated sample' })).toThrow()
  expect(() => registry.remove(node.id)).toThrow()
  expect(registry.list()).toEqual([node])
  expect(registry.authorizationId(node.id)).toBe(authority)
  expect(new NodeRegistry(f.host).authorizationId(node.id)).toBe(authority)
  f.free()
  registry.remove(node.id)
  expect(new NodeRegistry(f.host).list()).toEqual([])
})

it('cleans up the new local token when registration cannot be persisted', () => {
  const f = setup()
  const registry = new NodeRegistry(f.host)
  f.fill()
  expect(() =>
    registry.add(
      {
        id: 'sample-local',
        label: 'Local sample',
        url: 'http://127.0.0.1:7777',
        expectedNodeId: 'sample-local-node',
      },
      'sample-token'
    )
  ).toThrow()
  expect(f.host.removeSecret).toHaveBeenCalledWith('abele-node-sample-local')
  expect(registry.list()).toEqual([])
})
