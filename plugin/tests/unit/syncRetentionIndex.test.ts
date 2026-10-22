import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { completion } from '@/sync/idbRequests'

const local = { loadLocalStorage: () => null, saveLocalStorage: () => {} }
it('publishes count, bytes and expiry atomically with concurrent retained rows', async () => {
  const factory = new IDBFactory()
  const host = await HostSyncStorage.open(factory, 'sample', local)
  try {
    const index = host.retentionIndex('sample-root')
    await Promise.all([
      index.put({ id: 'one', at: 1000, size: 10, intent: {} }),
      index.put({ id: 'two', at: 2000, size: 20, intent: {} }),
    ])
    expect(await index.summary()).toMatchObject({
      count: 2,
      bytes: 30,
      earliestExpiry: 1000 + 7 * 86400000,
    })
    const failure = new Error('summary publication failed')
    const put = IDBObjectStore.prototype.put
    const injected = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      value,
      ...args
    ) {
      if (value.key.endsWith('!summary')) throw failure
      return put.call(this, value, ...args)
    })
    await expect(index.drop('one')).rejects.toBe(failure)
    injected.mockRestore()
    expect(await index.find('one')).toBeDefined()
    expect(await index.summary()).toMatchObject({ count: 2, bytes: 30 })
    await index.drop('one')
    await index.drop('one')
    expect(await index.summary()).toMatchObject({
      count: 1,
      bytes: 20,
      earliestExpiry: 2000 + 7 * 86400000,
    })
    host.close()
    const reopened = await HostSyncStorage.open(factory, 'sample', local)
    try {
      expect(await reopened.retentionIndex('sample-root').summary()).toMatchObject({
        count: 1,
        bytes: 20,
      })
    } finally {
      reopened.close()
    }
  } finally {
    vi.restoreAllMocks()
    host.close()
  }
})

it('reads one summary and seeks one oldest record with thirty thousand durable rows', async () => {
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample', local)
  try {
    const index = host.retentionIndex('sample-root')
    const db = Reflect.get(host, 'db') as IDBDatabase
    const prefix = Reflect.get(index, 'prefix') as string
    const tx = db.transaction('host', 'readwrite'),
      done = completion(tx, 'seed retention')
    const rows = tx.objectStore('host')
    for (let i = 0; i < 30000; i++)
      rows.put({
        namespace: 'sample',
        key: prefix + String(1000 + i).padStart(16, '0') + ':sample-' + i,
        value: { id: 'sample-' + i, at: 1000 + i, size: 1, intent: {} },
      })
    rows.put({
      namespace: 'sample',
      key: prefix + '!summary',
      value: { count: 30000, bytes: 30000, earliestExpiry: 1000 + 7 * 86400000, migrated: true },
    })
    await done
    const get = vi.spyOn(IDBObjectStore.prototype, 'get')
    const cursor = vi.spyOn(IDBObjectStore.prototype, 'openKeyCursor')
    expect(await host.retentionIndex('sample-root').summary()).toMatchObject({
      count: 30000,
      bytes: 30000,
    })
    expect(get).toHaveBeenCalledTimes(1)
    expect(cursor).not.toHaveBeenCalled()
    expect((await index.oldest())?.id).toBe('sample-0')
    expect(cursor).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(2)
  } finally {
    vi.restoreAllMocks()
    host.close()
  }
})
