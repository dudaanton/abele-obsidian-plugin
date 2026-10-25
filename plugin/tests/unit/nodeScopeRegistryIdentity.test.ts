// Scope travels across installations; registration authority still rotates on re-pairing.
import { describe, it, expect, vi } from 'vitest'
import { NodeRegistry, type PairedNode } from '@/node/NodeRegistry'
import { NodeScopeLedger, type NodeScopeChat } from '@/ai/nodeScope'
import { nodeRegistrationPrincipal } from '@/ai/tools/node/owner'

const node: PairedNode = {
  id: 'sample-registration',
  label: 'Sample node',
  expectedNodeId: 'sample-node',
  url: 'wss://sample-node.sample.ts.net/channel',
  profile: 'paired-wss-v1',
  installationId: 'sample-installation',
  nodeFingerprint: 'a'.repeat(64),
  publicKey: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) },
}
function setup() {
  let stored: unknown = []
  const host = {
    read: () => stored,
    write: vi.fn((value) => {
      stored = value
    }),
    getSecret: () => '',
    setSecret: vi.fn(),
    removeSecret: vi.fn(),
  }
  const registry = new NodeRegistry(host)
  registry.addPaired(node)
  const binding = (registry: NodeRegistry) => nodeRegistrationPrincipal(registry, node.id)
  return { registry, host, binding }
}
describe('durable registration authority for node scope', () => {
  it('keeps a registration authority stable across restart but rotates it on re-pairing', () => {
    const { registry, host, binding } = setup()
    const first = binding(registry)
    expect(binding(new NodeRegistry(host))).toBe(first)
    registry.addPaired(node)
    const second = binding(new NodeRegistry(host))
    expect(second).not.toBe(first)
    const chat: NodeScopeChat = {
      nodeScopeIdentity: 'sample-chat',
      conversationVersion: { value: 0 },
      overrides: {
        value: { nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'read' }] },
      },
    }
    let approvals: unknown
    const storage = {
      read: () => approvals,
      write: (value) => {
        approvals = value
      },
    }
    new NodeScopeLedger(storage).approve(chat, { 'sample-node': first })
    expect(new NodeScopeLedger(storage).approvedNode(chat, 'sample-node', second)).toBe(true)
    expect(registry.list()).toEqual([node])
  })
  it('removal and recreation rotate connection authority while configured scope travels', () => {
    const { registry, host, binding } = setup()
    let saved: unknown
    const storage = {
      read: () => saved,
      write: (value) => {
        saved = value
      },
    }
    const chat: NodeScopeChat = {
      nodeScopeIdentity: 'sample-chat',
      conversationVersion: { value: 0 },
      overrides: {
        value: { nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'edit' }] },
      },
    }
    new NodeScopeLedger(storage).approve(chat, { 'sample-node': binding(registry) })
    registry.remove(node.id)
    const reopened = new NodeRegistry(host)
    reopened.addPaired(node)
    expect(
      new NodeScopeLedger(storage).approvedNode(
        chat,
        'sample-node',
        binding(new NodeRegistry(host))
      )
    ).toBe(true)
  })
  it('persists an authority for old registrations before they can be approved', () => {
    let stored: unknown = [node]
    const host = {
      read: () => stored,
      write: vi.fn((value) => {
        stored = value
      }),
      getSecret: () => '',
      setSecret: vi.fn(),
      removeSecret: vi.fn(),
    }
    const first = new NodeRegistry(host)
    const identity = (first as unknown as { authorizationId(id: string): string }).authorizationId(
      node.id
    )
    expect(identity).toBeTruthy()
    expect(host.write).toHaveBeenCalledOnce()
    expect(
      (
        new NodeRegistry(host) as unknown as { authorizationId(id: string): string }
      ).authorizationId(node.id)
    ).toBe(identity)
    expect(host.write).toHaveBeenCalledOnce()
  })
})
