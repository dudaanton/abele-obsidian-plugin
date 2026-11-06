import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import type { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeManagerController } from '@/node/NodeManagerController'
import { NodeDelegationController } from '@/node/NodeDelegationController'

it('does not publish cached maps or stamps from an aborted record save', async () => {
  const factory = new IDBFactory()
  const reader = new NodeClientStore('sample-stamp-abort', factory)
  const writer = new NodeClientStore('sample-stamp-abort', factory)
  try {
    await writer.transaction((s) => {
      s.results.sample = { error: 'outcome_unknown' }
    })
    const before = await reader.read((s) => s.results)
    const original = IDBObjectStore.prototype.put
    let aborted = false
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = original.call(this, value, key)
      if (key === 'records-stamp') {
        aborted = true
        this.transaction.abort()
      }
      return request
    })
    try {
      await expect(
        writer.transaction((s) => {
          s.results.sample = { error: 'timeout' }
        })
      ).rejects.toThrow()
      expect(aborted).toBe(true)
    } finally {
      put.mockRestore()
    }
    expect(await reader.read((s) => s.results)).toBe(before)
    expect(await writer.read((s) => s.results.sample.error)).toBe('outcome_unknown')
    await writer.transaction((s) => {
      s.results.sample = { error: 'connection_lost' }
    })
    expect(await reader.read((s) => s.results.sample.error)).toBe('connection_lost')
  } finally {
    reader.close()
    writer.close()
  }
})

it('reads only small metadata during unchanged controller and store refreshes', async () => {
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
    expect(reads.filter(({ key }) => key.endsWith('-revisions'))).toEqual([])
    expect(reads.reduce((total, { bytes }) => total + bytes, 0)).toBeLessThanOrEqual(4096)
  } finally {
    store.close()
  }
})

it.each([false, true])(
  'imports legacy changes before reopening with a prior stamp: %s',
  async (stamped) => {
    const factory = new IDBFactory()
    const namespace = 'sample-legacy-manifest'
    const seed = new NodeClientStore(namespace, factory)
    let reader: NodeClientStore | undefined
    let legacy: IDBDatabase | undefined
    try {
      await seed.transaction((s) => {
        s.results.sample = { error: 'outcome_unknown' }
      })
      seed.close()
      legacy = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = factory.open('abele-node-' + namespace)
        opening.onsuccess = () => resolve(opening.result)
        opening.onerror = () => reject(opening.error)
      })
      const replace = (error: string | undefined, abort = false) =>
        new Promise<void>((resolve, reject) => {
          const tx = legacy!.transaction('client', 'readwrite')
          const object = tx.objectStore('client')
          if (!stamped) object.delete('records-stamp')
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
      await replace('connection_lost')
      reader = new NodeClientStore(namespace, factory)
      expect(await reader.read((s) => s.results.sample.error)).toBe('connection_lost')
      reader.close()
      await replace(undefined)
      reader = new NodeClientStore(namespace, factory)
      expect(await reader.read((s) => s.results.sample)).toBeUndefined()
    } finally {
      legacy?.close()
      seed.close()
      reader?.close()
    }
  }
)
