import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { retireHostStorage } from '@/sync/hostStorageShutdown'
import { pendingTeardown } from '@/sync/teardownBarrier'
import * as snapshotRetry from '@/sync/hostSnapshotRetry'
import { hostChanges } from '@/sync/hostSyncRecords'
import { openHostDatabase, STORE } from '@/sync/hostSyncSchema'
import { wait } from '@/sync/idbRequests'
import { deferred } from '../helpers/deferred'

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

it('does not resurrect a receipt retired while an opener was paused', async () => {
  const factory = new IDBFactory()
  const app = { loadLocalStorage: () => null, saveLocalStorage: () => {} }
  const namespace = 'sample-replay-race'
  const key = 'abele-external-last-opened-v1'
  const host = await HostSyncStorage.open(factory, namespace, app)
  host.saveLocalStorage(key, { sample: 1 })
  await host.flush()
  const put = IDBObjectStore.prototype.put
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    row,
    id
  ) {
    if (row.key === key) {
      this.transaction.abort()
      throw new Error('sample interrupted commit')
    }
    return put.call(this, row, id)
  })
  host.saveLocalStorage(key, { sample: 2 })
  await expect(host.flush()).rejects.toThrow('sample interrupted commit')
  failure.mockRestore()
  const discovered = deferred<void>()
  const resume = deferred<void>()
  const read = snapshotRetry.readSnapshotRetries
  const pause = vi
    .spyOn(snapshotRetry, 'readSnapshotRetries')
    .mockImplementationOnce(async (...args) => {
      const rows = await read(...args)
      discovered.resolve()
      await resume.promise
      return rows
    })
  let opener: HostSyncStorage | undefined
  try {
    const opening = HostSyncStorage.open(factory, namespace, { ...app })
    await discovered.promise
    await host.flush()
    host.saveLocalStorage(key, { sample: 3 })
    await host.flush()
    resume.resolve()
    opener = await opening
    expect(opener.loadLocalStorage(key)).toEqual({ sample: 3 })
  } finally {
    resume.resolve()
    pause.mockRestore()
    opener?.close()
    host.close()
  }
  const reopened = await HostSyncStorage.open(factory, namespace, { ...app })
  expect(reopened.loadLocalStorage(key)).toEqual({ sample: 3 })
  reopened.close()
})

it.each([false, true])(
  'retires an obsolete receipt with durable evidence (interrupted=%s)',
  async (interrupted) => {
    const factory = new IDBFactory()
    const namespace = 'sample-obsolete-receipt'
    const app = { loadLocalStorage: () => null, saveLocalStorage: () => {} }
    const key = 'abele-external-last-opened-v1'
    const host = await HostSyncStorage.open(factory, namespace, app)
    host.saveLocalStorage(key, { sample: 3 })
    await host.flush()
    host.close()
    const db = await openHostDatabase(factory)
    const receiptKey = snapshotRetry.SNAPSHOT_RETRY_PREFIX + 'sample'
    const changes = hostChanges(key, { sample: 1 }, { sample: 2 })
    await snapshotRetry.stageSnapshotRetry(db, namespace, receiptKey, changes)
    try {
      if (interrupted) {
        const put = IDBObjectStore.prototype.put
        const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
          this: IDBObjectStore,
          row,
          id
        ) {
          if (row.key?.startsWith('!snapshot-obsolete:' + receiptKey + ':')) {
            this.transaction.abort()
            throw new Error('sample evidence interrupted')
          }
          return put.call(this, row, id)
        })
        try {
          await expect(HostSyncStorage.open(factory, namespace, { ...app })).rejects.toThrow(
            'sample evidence interrupted'
          )
        } finally {
          failure.mockRestore()
        }
        expect(await snapshotRetry.readSnapshotRetries(db, namespace)).toHaveLength(1)
      }
      for (let i = 0; i < 2; i++) {
        const reopened = await HostSyncStorage.open(factory, namespace, { ...app })
        expect(reopened.loadLocalStorage(key)).toEqual({ sample: 3 })
        reopened.close()
      }
      expect(await snapshotRetry.readSnapshotRetries(db, namespace)).toEqual([])
      const rows = await wait<{ key: string; value: unknown }[]>(
        db.transaction(STORE).objectStore(STORE).getAll()
      )
      expect(
        rows.find((row) => row.key?.startsWith('!snapshot-obsolete:' + receiptKey + ':'))?.value
      ).toMatchObject({
        changes,
        reason: 'concurrent snapshot changed',
        current: [expect.objectContaining({ value: { kind: 'document', value: { sample: 3 } } })],
      })
    } finally {
      db.close()
    }
  }
)
