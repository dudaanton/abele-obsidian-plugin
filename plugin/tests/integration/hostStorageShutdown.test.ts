import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { retireHostStorage } from '@/sync/hostStorageShutdown'
import { pendingTeardown } from '@/sync/teardownBarrier'

it.each(['commit', 'receipt'])(
  'reopens and recovers snapshots after a shutdown %s fails',
  async (phase) => {
    const values = new Map<string, unknown>()
    const app = {
      loadLocalStorage: (key: string) => values.get(key),
      saveLocalStorage: (key: string, value: unknown) => {
        values.set(key, value)
      },
    }
    const factory = new IDBFactory()
    const host = await HostSyncStorage.open(factory, 'sample-shutdown', app)
    const key = 'abele-sync-settings-sections-v1'
    const historyKey = 'abele-external-last-opened-v1'
    const snapshot = {
      v: 1,
      chosen: [],
      local: { reader: { fontSize: 150 } },
      remote: {},
      base: {},
      kept: [],
    }
    const put = IDBObjectStore.prototype.put
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      row,
      id
    ) {
      if (phase === 'commit' ? row.key === key : row.key?.startsWith('!snapshot-retry:')) {
        this.transaction.abort()
        throw new Error('shutdown commit failed')
      }
      return put.call(this, row, id)
    })
    try {
      host.saveLocalStorage(key, snapshot)
      host.saveLocalStorage(historyKey, { 'Media/sample.png': 123 })
      await retireHostStorage(app, host, Promise.resolve()).catch(() => {})
      if (phase === 'receipt') {
        // Another reload during the outage must retain the queue for a later retry.
        await expect(pendingTeardown(app)).rejects.toThrow('shutdown commit failed')
      } else {
        // A failed startup replay must keep the receipt across another restart.
        await expect(HostSyncStorage.open(factory, 'sample-shutdown', { ...app })).rejects.toThrow(
          'shutdown commit failed'
        )
      }
    } finally {
      failure.mockRestore()
    }
    await expect(pendingTeardown(app)).resolves.toBeUndefined()
    // A new app object has no teardown state or old store instance to supply the data.
    const reopened = await HostSyncStorage.open(factory, 'sample-shutdown', { ...app })
    try {
      expect(reopened.loadLocalStorage(key)).toEqual(snapshot)
      expect(reopened.loadLocalStorage(historyKey)).toEqual({ 'Media/sample.png': 123 })
    } finally {
      reopened.close()
    }
  }
)

it('does not clear a failed engine stop through snapshot recovery', async () => {
  const app = { loadLocalStorage: () => null, saveLocalStorage: () => {} }
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-engine-failure', app)
  try {
    await expect(
      retireHostStorage(app, host, Promise.reject(new Error('engine still active')))
    ).rejects.toThrow('engine still active')
    await expect(pendingTeardown(app)).rejects.toThrow('engine still active')
  } finally {
    host.close()
  }
})
