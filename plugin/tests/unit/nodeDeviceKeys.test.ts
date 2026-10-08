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

it('fails closed without a cross-window lock service', async () => {
  const store = new NodeDeviceKeyStore('sample-no-lock', new IDBFactory(), undefined)
  await expect(
    store.transaction('sample-node', async () => ({ device: await device(), result: undefined }))
  ).rejects.toThrow('Web Locks')
  store.close()
})
