import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { generateIdentity, fingerprint, signProof, verifyProof } from '@abele/channel-protocol'
import { NodeDeviceKeyStore } from '@/node/NodeDeviceKeyStore'
import type { PairedDevice } from '@abele/node-client'

// The same lock service is shared by independent adapters, just like navigator.locks
// across windows. Async crypto runs outside the IndexedDB transaction.
function locks() {
  const pending = new Map<string, Promise<unknown>>()
  return {
    request: async <T>(name: string, work: () => Promise<T>): Promise<T> => {
      const prior = pending.get(name) ?? Promise.resolve()
      const next = prior.catch(() => {}).then(work)
      pending.set(name, next)
      return next
    },
  }
}
const device = async (): Promise<PairedDevice> => ({
  ...(await generateIdentity()),
  node_id: 'sample-node',
  endpoint: 'wss://sample.example.ts.net:8443/channel',
  node_fingerprint: 'a'.repeat(64),
})

it('serializes asynchronous key creation across two windows and persists a non-extractable key', async () => {
  const factory = new IDBFactory(),
    lock = locks()
  const a = new NodeDeviceKeyStore('sample-device', factory, lock)
  const b = new NodeDeviceKeyStore('sample-device', factory, lock)
  let creations = 0
  const claim = (store: NodeDeviceKeyStore) =>
    store.transaction('sample-node', async (old) => {
      if (!old) creations++
      const current = old ?? (await device())
      return { device: current, result: current.public_key }
    })
  const [first, second] = await Promise.all([claim(a), claim(b)])
  expect(first).toEqual(second)
  expect(creations).toBe(1)
  a.close()
  b.close()
  const restored = new NodeDeviceKeyStore('sample-device', factory, lock)
  const value = (await restored.load('sample-node'))!
  expect(value.private_key.extractable).toBe(false)
  expect(
    await verifyProof(
      value.public_key,
      ['sample-proof'],
      await signProof(value.private_key, ['sample-proof'])
    )
  ).toBe(true)
  await expect(crypto.subtle.exportKey('jwk', value.private_key)).rejects.toThrow()
  value.endpoint = 'changed'
  expect((await restored.load('sample-node'))!.endpoint).not.toBe('changed')
  restored.close()
})

it('rolls back rejected changes and isolates namespaces', async () => {
  const factory = new IDBFactory(),
    lock = locks()
  const a = new NodeDeviceKeyStore('sample-one', factory, lock)
  const original = await device()
  await a.transaction(original.node_id, async () => ({ device: original, result: undefined }))
  await expect(
    a.transaction(original.node_id, async (old) => {
      old!.node_fingerprint = 'b'.repeat(64)
      await fingerprint(old!.public_key)
      throw new Error('sample failure')
    })
  ).rejects.toThrow('sample failure')
  expect((await a.load(original.node_id))!.node_fingerprint).toBe(original.node_fingerprint)
  const other = new NodeDeviceKeyStore('sample-two', factory, lock)
  expect(await other.load(original.node_id)).toBeUndefined()
  a.close()
  other.close()
})

const invitation = {
  node_id: 'sample-node',
  endpoint: 'wss://sample.example.ts.net:8443/channel',
  node_fingerprint: 'a'.repeat(64),
  invite_id: 'sample-invitation',
  secret: 'b'.repeat(64),
  expires_at: 1999999999999,
}

it('tracks only the exact acknowledged invitation, resetting a prior claim for a new enrollment', async () => {
  const store = new NodeDeviceKeyStore('sample-claims', new IDBFactory(), locks())
  const first = await store.rememberInvitation(invitation, 'Sample node')
  const claim = {
    installation_id: 'sample-installation',
    device_fingerprint: await fingerprint(first.public_key),
    state: 'pending' as const,
  }
  await store.transaction(invitation.node_id, async (current) => ({
    device: { ...current!, installation_id: claim.installation_id },
    result: undefined,
  }))
  await store.recordClaim(invitation, claim)
  expect((await store.load(invitation.node_id))!.enrollment!.claim).toEqual(claim)
  await store.rememberInvitation(invitation, 'Updated label')
  expect((await store.load(invitation.node_id))!.enrollment!.claim).toEqual(claim)
  const next = { ...invitation, invite_id: 'sample-new-invitation' }
  await store.rememberInvitation(next, 'Sample next attempt')
  expect((await store.load(invitation.node_id))!.enrollment!.claim).toBeUndefined()
  await expect(store.recordClaim(invitation, claim)).rejects.toThrow('enrollment_changed')
  expect((await store.load(invitation.node_id))!.enrollment!.invite).toEqual(next)
  store.close()
})

it('clears only acknowledged enrollment evidence, with a matching positive and idempotent control', async () => {
  const store = new NodeDeviceKeyStore('sample-exact-completion', new IDBFactory(), locks())
  const saved = await store.rememberInvitation(invitation, 'Sample node')
  const claim = {
    installation_id: 'sample-installation',
    device_fingerprint: await fingerprint(saved.public_key),
    state: 'pending' as const,
  }
  await store.transaction(invitation.node_id, async (current) => ({
    device: { ...current!, installation_id: claim.installation_id },
    result: undefined,
  }))
  const expected = { ...invitation, ...claim }
  expect(await store.finishEnrollment(invitation.node_id, expected)).toBe(false)
  expect((await store.load(invitation.node_id))!.enrollment).toBeDefined()
  await store.recordClaim(invitation, claim)
  expect(
    await store.finishEnrollment(invitation.node_id, {
      ...expected,
      device_fingerprint: 'c'.repeat(64),
    })
  ).toBe(false)
  expect(await store.finishEnrollment(invitation.node_id, expected)).toBe(true)
  expect((await store.load(invitation.node_id))!.enrollment).toBeUndefined()
  expect(await store.finishEnrollment(invitation.node_id, expected)).toBe(true)
  store.close()
})

it('authorizes an endpoint change explicitly and refuses stale endpoint or pin expectations', async () => {
  const store = new NodeDeviceKeyStore('sample-endpoint', new IDBFactory(), locks())
  const first = await store.rememberInvitation(invitation, 'Sample node')
  const next = {
    ...invitation,
    endpoint: 'wss://other.example.ts.net:9443/channel',
    invite_id: 'sample-new-invitation',
  }
  await expect(store.rememberInvitation(next, 'Sample node')).rejects.toThrow(
    'node_identity_mismatch'
  )
  await expect(
    store.authorizeEndpointChange(next, next.endpoint, invitation.node_fingerprint)
  ).rejects.toThrow('node_identity_mismatch')
  await expect(
    store.authorizeEndpointChange(next, invitation.endpoint, 'c'.repeat(64))
  ).rejects.toThrow('node_identity_mismatch')
  await store.authorizeEndpointChange(next, invitation.endpoint, invitation.node_fingerprint)
  const changed = await store.rememberInvitation(next, 'Sample node')
  expect(changed.endpoint).toBe(next.endpoint)
  expect(changed.public_key).toEqual(first.public_key)
  expect(changed.node_fingerprint).toBe(first.node_fingerprint)
  store.close()
})

it.each(['invite', 'endpoint', 'fingerprint'] as const)(
  'does not let old completion erase a newer %s enrollment from another window',
  async (change) => {
    const factory = new IDBFactory(),
      lock = locks()
    const a = new NodeDeviceKeyStore('sample-completion-' + change, factory, lock)
    const b = new NodeDeviceKeyStore('sample-completion-' + change, factory, lock)
    const saved = await a.rememberInvitation(invitation, 'Sample node')
    const claim = {
      installation_id: 'sample-installation',
      device_fingerprint: await fingerprint(saved.public_key),
      state: 'pending' as const,
    }
    await a.transaction(invitation.node_id, async (current) => ({
      device: { ...current!, installation_id: claim.installation_id },
      result: undefined,
    }))
    await a.transaction(invitation.node_id, async (current) => ({
      device: { ...current!, enrollment: { invite: invitation, label: 'Sample node', claim } },
      result: undefined,
    }))
    const expected = { ...invitation, ...claim }
    const next = {
      ...invitation,
      ...(change === 'invite'
        ? { invite_id: 'sample-new-invitation' }
        : change === 'endpoint'
          ? { endpoint: 'wss://other.example.ts.net:9443/channel' }
          : { node_fingerprint: 'c'.repeat(64) }),
    }
    await b.transaction(invitation.node_id, async (current) => ({
      device: {
        ...current!,
        endpoint: next.endpoint,
        node_fingerprint: next.node_fingerprint,
        enrollment: { invite: next, label: 'Sample newer attempt' },
      },
      result: undefined,
    }))
    expect(await a.finishEnrollment(invitation.node_id, expected)).toBe(false)
    expect((await b.load(invitation.node_id))!.enrollment!.invite).toEqual(next)
    a.close()
    b.close()
  }
)

it('fails closed without a cross-window lock service', async () => {
  const store = new NodeDeviceKeyStore('sample-no-lock', new IDBFactory(), undefined)
  await expect(
    store.transaction('sample-node', async () => ({ device: await device(), result: undefined }))
  ).rejects.toThrow('Web Locks')
  store.close()
})
