import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient, PairedWssConnector } from '@abele/node-client'
import {
  FrameCodec,
  LIMITS,
  generateIdentity,
  fingerprint,
  randomNonce,
  signProof,
  verifyProof,
  proofTranscript,
  type RecordTransport,
  type RecordFrame,
  type DeviceChallenge,
} from '@abele/channel-protocol'
import { NodeDeviceKeyStore } from '@/node/NodeDeviceKeyStore'
import { NodeClientStore } from '@/node/NodeClientStore'
import { collectEntries } from '@/transfer/entries'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

function lockService() {
  const tasks = new Map<string, Promise<unknown>>()
  return {
    request: <T>(name: string, work: () => Promise<T>) => {
      const task = (tasks.get(name) ?? Promise.resolve()).catch(() => {}).then(work)
      tasks.set(name, task)
      return task
    },
  }
}
async function endpoint() {
  const identity = await generateIdentity()
  const invite = {
    node_id: 'sample-node',
    endpoint: 'wss://sample.example.ts.net:8443/channel',
    node_fingerprint: await fingerprint(identity.public_key),
    invite_id: 'sample-invitation',
    secret: randomNonce(),
    expires_at: 1,
  }
  let devicePin = '',
    confirmed = false,
    revoked = false,
    loseReply = true
  const opens: string[] = []
  let claimGate = async () => {}
  const open = async (url: string): Promise<RecordTransport> => {
    opens.push(url)
    const queue: Uint8Array[] = []
    let wake: (() => void) | undefined,
      closed = false,
      challenge: DeviceChallenge | undefined
    let deviceKey: Parameters<typeof fingerprint>[0]
    const publish = (frame: RecordFrame) => {
      queue.push(FrameCodec.encode(frame))
      wake?.()
    }
    return {
      async send(bytes) {
        const frame = FrameCodec.decode(bytes)
        if (frame.kind === 'paired.begin') {
          deviceKey = frame.public_key
          challenge = {
            kind: 'paired.challenge',
            profile: 'paired-wss-v1',
            connection_id: randomNonce(),
            client_nonce: frame.client_nonce,
            node_id: invite.node_id,
            endpoint: url,
            installation_id: frame.invite ? frame.invite.invite_id : 'sample-installation',
            device_fingerprint: await fingerprint(deviceKey),
            purpose: frame.invite ? 'claim' : 'connect',
            expires_at: Date.now() + 10000,
            node_key: identity.public_key,
            signature: '',
          }
          challenge.signature = await signProof(
            identity.private_key,
            proofTranscript(challenge, 'node')
          )
          publish(challenge)
        } else if (frame.kind === 'paired.proof') {
          expect(
            await verifyProof(deviceKey, proofTranscript(challenge!, 'device'), frame.signature)
          ).toBe(true)
          const pin = await fingerprint(deviceKey)
          if (revoked || (devicePin && devicePin !== pin)) throw new Error('unauthorized')
          if (challenge!.purpose === 'claim') {
            devicePin = pin
            if (loseReply) {
              loseReply = false
              closed = true
              wake?.()
              return
            }
            await claimGate()
            publish({
              kind: 'paired.claimed',
              claim: {
                installation_id: 'sample-installation',
                device_fingerprint: pin,
                state: confirmed ? 'confirmed' : 'pending',
              },
            })
          } else {
            if (!confirmed) throw new Error('unauthorized')
            publish({ kind: 'authenticated', installation_id: 'sample-installation' })
          }
        } else if (frame.kind === 'hello')
          publish({
            kind: 'welcome',
            version: { major: 0, minor: 0 },
            node_id: invite.node_id,
            installation_id: 'sample-installation',
            instance_id: 'sample-instance',
            methods: ['node.describe'],
            limits: { ...LIMITS },
            capabilities: {},
          })
        else if (frame.kind === 'request')
          publish({
            kind: 'response',
            request_id: frame.request_id,
            result: { provider: 'fake', available: true },
          })
      },
      async *receive() {
        while (!closed || queue.length) {
          if (queue.length) yield queue.shift()!
          else
            await new Promise<void>((resolve) => {
              wake = resolve
            })
        }
      },
      async close() {
        closed = true
        wake?.()
      },
    }
  }
  return {
    invite,
    open,
    opens,
    holdClaim: (gate: () => Promise<void>) => {
      claimGate = gate
    },
    confirm: () => {
      confirmed = true
    },
    revoke: () => {
      revoked = true
    },
  }
}

it('recovers a lost claim with the same persisted key across independent adapters, then connects only after confirmation', async () => {
  const server = await endpoint(),
    factory = new IDBFactory(),
    locks = lockService()
  const a = new NodeDeviceKeyStore('sample', factory, locks)
  await a.rememberInvitation(server.invite, 'Sample remote')
  await expect(new PairedWssConnector(a, server.open).claim(server.invite)).rejects.toThrow(
    'connection_closed'
  )
  const firstPin = await fingerprint((await a.load(server.invite.node_id))!.public_key)
  a.close()
  const b = new NodeDeviceKeyStore('sample', factory, locks)
  const resumed = (await b.pending())[0]
  expect(resumed.enrollment!.invite).toEqual(server.invite)
  const connector = new PairedWssConnector(b, server.open)
  const claim = await connector.claim(resumed.enrollment!.invite)
  await b.recordClaim(resumed.enrollment!.invite, claim)
  expect(claim.device_fingerprint).toBe(firstPin)
  const target = await connector.target(server.invite.node_id)
  await expect(connector.connect(target)).rejects.toThrow('unauthorized')
  server.confirm()
  const store = new NodeClientStore('sample-paired', factory)
  const client = new NodeClient(target, store, connector)
  try {
    await client.connect()
    expect(await client.describe()).toMatchObject({ provider: 'fake' })
    expect(await store.transaction((s) => [s.node_id, s.installation_id])).toEqual([
      'sample-node',
      'sample-installation',
    ])
    expect(await b.finishEnrollment(server.invite.node_id, { ...server.invite, ...claim })).toBe(
      true
    )
    expect(await b.pending()).toEqual([])
    server.revoke()
    await client.disconnect()
    await expect(client.connect()).rejects.toThrow('unauthorized')
    expect(server.opens.every((url) => url === server.invite.endpoint)).toBe(true)
  } finally {
    await client.disconnect()
    store.close()
    b.close()
  }
})

it('claims and connects at an explicitly changed endpoint with the same device key and principal', async () => {
  const server = await endpoint(),
    keys = new NodeDeviceKeyStore('sample-endpoint-migration', new IDBFactory(), lockService())
  const connector = new PairedWssConnector(keys, server.open)
  await keys.rememberInvitation(server.invite, 'Sample node')
  await connector.claim(server.invite).catch(() => {})
  const first = await connector.claim(server.invite)
  await keys.recordClaim(server.invite, first)
  const next = {
    ...server.invite,
    endpoint: 'wss://other.example.ts.net:9443/channel',
    invite_id: 'sample-new-invitation',
  }
  await expect(connector.claim(next)).rejects.toThrow('node_identity_mismatch')
  await keys.authorizeEndpointChange(next, server.invite.endpoint, server.invite.node_fingerprint)
  await keys.rememberInvitation(next, 'Sample moved node')
  const claim = await connector.claim(next)
  await keys.recordClaim(next, claim)
  expect(claim.installation_id).toBe(first.installation_id)
  expect(claim.device_fingerprint).toBe(first.device_fingerprint)
  server.confirm()
  const channel = await connector.connect(await connector.target(next.node_id))
  expect(server.opens.at(-1)).toBe(next.endpoint)
  expect(await keys.finishEnrollment(next.node_id, { ...next, ...claim })).toBe(true)
  await channel.transport.close('test_complete')
  keys.close()
})

it('does not bind a late response over an independently committed node pin change', async () => {
  const server = await endpoint(),
    factory = new IDBFactory(),
    locks = lockService()
  const a = new NodeDeviceKeyStore('sample-late', factory, locks)
  const b = new NodeDeviceKeyStore('sample-late', factory, locks)
  const first = new PairedWssConnector(a, server.open),
    other = new PairedWssConnector(b, server.open)
  await first.claim(server.invite).catch(() => {})
  let release!: () => void, arrived!: () => void
  const waiting = new Promise<void>((resolve) => {
    arrived = resolve
  })
  server.holdClaim(async () => {
    arrived()
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  const claim = first.claim(server.invite)
  await waiting
  await other.authorizeNodeKeyChange(
    { ...server.invite, node_fingerprint: 'a'.repeat(64) },
    server.invite.node_fingerprint
  )
  release()
  await expect(claim).rejects.toThrow('device_identity_mismatch')
  expect((await b.load(server.invite.node_id))!.installation_id).toBeUndefined()
  expect((await b.load(server.invite.node_id))!.node_fingerprint).toBe('a'.repeat(64))
  a.close()
  b.close()
})

it('refuses pin changes without explicit owner verification and preserves the installation on authorized recovery', async () => {
  const server = await endpoint(),
    store = new NodeDeviceKeyStore('sample-recovery', new IDBFactory(), lockService())
  const connector = new PairedWssConnector(store, server.open)
  await connector.claim(server.invite).catch(() => {})
  await connector.claim(server.invite)
  const changed = { ...server.invite, node_fingerprint: 'a'.repeat(64) }
  await expect(connector.claim(changed)).rejects.toThrow('node_identity_mismatch')
  const opens = server.opens.length
  await expect(connector.authorizeNodeKeyChange(changed, 'b'.repeat(64))).rejects.toThrow(
    'node_identity_mismatch'
  )
  expect(server.opens).toHaveLength(opens)
  await connector.authorizeNodeKeyChange(changed, server.invite.node_fingerprint)
  expect((await store.load(server.invite.node_id))!.installation_id).toBe('sample-installation')
  expect((await store.load(server.invite.node_id))!.node_fingerprint).toBe(changed.node_fingerprint)
  await expect(connector.claim(changed)).rejects.toThrow('node_identity_mismatch')
  store.close()
})

it('never exports device keys, invitation secrets, client caches or node registrations with settings', () => {
  useVault([])
  const settings = {
    ...AbeleConfig.getInstance().settings,
    nodeDeviceKeys: 'sample-private-key',
    nodeRegistry: 'sample-endpoint',
    nodeInvitation: 'sample-invite-secret',
    nodeClientCache: 'sample-history',
  }
  const exported = JSON.stringify(collectEntries(settings))
  for (const value of [
    'sample-private-key',
    'sample-invite-secret',
    'sample-history',
    'sample-endpoint',
  ])
    expect(exported).not.toContain(value)
})
