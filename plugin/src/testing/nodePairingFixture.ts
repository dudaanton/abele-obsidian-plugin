import { ref } from 'vue'
import type { NodeService } from '@/node/NodeService'

/** Presentation-only enrollment; no real key, invitation or connection is used. */
export function nodePairingFixture(mode: 'waiting' | 'recovery') {
  const invite = {
    endpoint: 'wss://sample.example.ts.net:8443/channel',
    node_id: 'sample-node',
    node_fingerprint: 'a'.repeat(64),
    invite_id: 'sample-invitation',
    secret: 'b'.repeat(64),
    expires_at: 1999999999999,
  }
  const node = {
    id: 'sample-registration',
    label: 'Sample remote node',
    expectedNodeId: invite.node_id,
    url: invite.endpoint,
    profile: 'paired-wss-v1',
    installationId: 'sample-installation',
    nodeFingerprint: invite.node_fingerprint,
  }
  const device = {
    node_id: invite.node_id,
    node_fingerprint: mode === 'recovery' ? 'd'.repeat(64) : invite.node_fingerprint,
    installation_id: node.installationId,
    enrollment: { invite, label: node.label },
  }
  const service = {
    nodes: ref(mode === 'waiting' ? [node] : []),
    deviceKeys: {
      load: async () => device,
      pending: async () => [device],
      finishEnrollment: async () => {},
    },
    deviceFingerprint: async () => 'c'.repeat(64),
    connection: () => ({
      state: ref('offline'),
      connect: async () => {
        throw new Error('Owner confirmation is still pending')
      },
    }),
    pairedConnector: { authorizeNodeKeyChange: async () => {} },
    pair: async () => node,
  } as unknown as NodeService
  return { service, resumeNodeId: invite.node_id }
}
