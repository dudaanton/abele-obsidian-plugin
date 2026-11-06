import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import type { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeManagerController } from '@/node/NodeManagerController'
import { NodeDelegationController } from '@/node/NodeDelegationController'

// BUG: Manifests have no legacy-writer-compatible change token. Every idle load
// clones the complete revision maps even when no record payload has changed.
it.fails('reads only small metadata during unchanged controller and store refreshes', async () => {
  const store = new NodeClientStore('sample-read-volume', new IDBFactory())
  try {
    await store.transaction((s) => {
      s.managerOperations = {}
      for (let i = 0; i < 3000; i++) {
        const id = `sample-${i}`
        s.results[id] = { error: 'outcome_unknown' }
        s.managerOperations[id] = { parent: 'sample-parent', method: 'command.v1.run', params: {} }
      }
    })
    const client = { connected: false } as NodeClient
    const delegation = new NodeDelegationController(client, store)
    const manager = new NodeManagerController(client, store)
    const refresh = async () => {
      await delegation.restore()
      await manager.wakeDelivered(() => false)
      await store.transaction((s) => {
        s.outbox = s.outbox.filter(() => true)
      })
    }
    await refresh()
    const reads: { key: string; bytes: number }[] = []
    const original = IDBObjectStore.prototype.get
    const get = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (key) {
      const request = original.call(this, key)
      request.addEventListener('success', () => {
        reads.push({
          key: String(key),
          bytes: new TextEncoder().encode(JSON.stringify(request.result) ?? '').length,
        })
      })
      return request
    })
    try {
      await refresh()
    } finally {
      get.mockRestore()
    }
    console.info('unchanged refresh IDB reads', JSON.stringify(reads))
    expect(reads.filter(({ key }) => key.startsWith('record:'))).toEqual([])
    expect(reads.reduce((total, { bytes }) => total + bytes, 0)).toBeLessThanOrEqual(4096)
  } finally {
    store.close()
  }
})

it('observes legacy manifest replacements without any metadata or sidecar revision write', async () => {
  const factory = new IDBFactory()
  const namespace = 'sample-legacy-manifest'
  const reader = new NodeClientStore(namespace, factory)
  let legacy: IDBDatabase | undefined
  try {
    await reader.transaction((s) => {
      s.results.sample = { error: 'outcome_unknown' }
    })
    const before = await reader.read((s) => s.results)
    legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open('abele-node-' + namespace)
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const replace = (error: string | undefined, abort = false) =>
      new Promise<void>((resolve, reject) => {
        const tx = legacy!.transaction('client', 'readwrite')
        const object = tx.objectStore('client')
        const request = object.get('record-revisions')
        request.onsuccess = () => {
          const manifest = request.result
          const key = 'record:results:sample'
          if (error) {
            object.put({ error }, key)
            manifest[key] = crypto.randomUUID()
          } else {
            object.delete(key)
            delete manifest[key]
          }
          object.put(manifest, 'record-revisions')
          if (abort) tx.abort()
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () => (abort ? resolve() : reject(tx.error))
      })
    await replace('sample-aborted', true)
    expect(await reader.read((s) => s.results)).toBe(before)
    await replace('connection_lost')
    expect(await reader.read((s) => s.results.sample.error)).toBe('connection_lost')
    await replace(undefined)
    expect(await reader.read((s) => s.results.sample)).toBeUndefined()
  } finally {
    legacy?.close()
    reader.close()
  }
})
