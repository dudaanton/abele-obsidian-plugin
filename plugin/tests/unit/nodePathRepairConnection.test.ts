import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { NodeService } from '@/node/NodeService'
vi.mock('@/node/NodePathObsidianActions', () => ({
  revokeNodePathChatApprovals: vi.fn(async () => {}),
}))
vi.mock('@/agents/AgentsService', () => ({
  AgentsService: { getInstance: () => ({ setNodes() {} }) },
}))
it('preserves the connection, client and store observed by existing path views and chats on same-principal re-pairing', async () => {
  const target = {
    profile: 'paired-wss-v1',
    expected_node_id: 'sample-node',
    installation_id: 'sample-installation',
    node_fingerprint: 'a'.repeat(64),
    public_key: {
      kty: 'EC',
      crv: 'P-256',
      x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      y: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    },
    url: 'wss://sample.invalid:8443',
  }
  const device = {
    node_id: target.expected_node_id,
    installation_id: target.installation_id,
    node_fingerprint: target.node_fingerprint,
    public_key: target.public_key,
    endpoint: target.url,
  }
  const registration = {
    id: 'sample-registration',
    label: 'Sample node',
    profile: target.profile,
    expectedNodeId: target.expected_node_id,
    installationId: target.installation_id,
    url: target.url,
    nodeFingerprint: target.node_fingerprint,
    publicKey: target.public_key,
  }
  const candidateStore = {
    transaction: async (work: any) => work({ node_id: target.expected_node_id }),
    close: vi.fn(),
  }
  const candidate = {
    connected: true,
    target,
    store: candidateStore,
    disconnect: vi.fn(async () => {}),
  }
  const oldClient = { target: { ...target, url: 'wss://previous.invalid:8443' } }
  const original = {
    client: oldClient,
    store: {},
    destroy: vi.fn(),
    refreshAuthorization: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    start: vi.fn(),
  }
  const service = {
    registry: { list: () => [registration], addPaired: vi.fn() },
    nodes: ref([registration]),
    connections: new Map([[registration.id, original]]),
    deviceKeys: { load: async () => device, finishEnrollment: vi.fn() },
  }
  await NodeService.prototype.adoptPaired.call(
    service as never,
    'Sample repaired node',
    candidate as never,
    candidateStore as never
  )
  expect(service.connections.get(registration.id)).toBe(original)
  expect(original.destroy).not.toHaveBeenCalled()
  expect(original.client).toBe(oldClient)
  expect(oldClient.target.url).toBe(target.url)
  expect(original.connect).toHaveBeenCalledOnce()
  expect(candidate.disconnect).toHaveBeenCalledOnce()
  expect(candidateStore.close).toHaveBeenCalledOnce()
})
