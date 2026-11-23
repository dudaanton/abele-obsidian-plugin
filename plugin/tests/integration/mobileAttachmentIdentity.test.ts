import type { App } from 'obsidian'
import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'
import { TokenAttachmentHost } from '@/sync/tokenAttachmentHost'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { ExternalFileHost } from '@/sync/external/ObsidianExternalFileHost'
import { buildFakeVault } from '../helpers/fakeVault'
import { openHostDatabase, STORE, RECORDS, recordKey } from '@/sync/hostSyncSchema'
import { completion, wait } from '@/sync/idbRequests'

it('migrates existing consent identities after host storage was already initialized', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'sample bytes' }])
  const key = 'abele-token-local-files-v1'
  const id = crypto.randomUUID()
  const rows = [
    { id, path: 'sample.bin', birth: app.vault.getFileByPath('sample.bin')!.stat.ctime },
  ]
  app.saveLocalStorage(key, rows)
  const factory = new IDBFactory()
  const original = await HostSyncStorage.open(factory, 'sample-upgrade', app)
  original.close()
  // An older host schema has migration markers but no attachment identity key.
  const db = await openHostDatabase(factory)
  const tx = db.transaction([STORE, RECORDS], 'readwrite')
  const done = completion(tx, 'cannot prepare previous schema')
  await wait(tx.objectStore(STORE).delete(['sample-upgrade', key]))
  await wait(tx.objectStore(RECORDS).delete(recordKey('sample-upgrade', key, '!header')))
  await done
  db.close()
  const storage = await HostSyncStorage.open(factory, 'sample-upgrade', app)
  const save = vi.spyOn(app, 'saveLocalStorage').mockImplementation(() => {})
  try {
    const host = new TokenAttachmentHost(app as unknown as App)
    expect(host.resolve(id)?.path).toBe('sample.bin')
    await host.remember('sample.bin')
    expect(storage.loadLocalStorage(key)).toEqual(rows)
  } finally {
    storage.close()
    save.mockRestore()
  }
})

it('retains mobile attachment identity when host local storage refuses writes', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'sample bytes' }])
  app.workspace.iterateAllLeaves = () => {}
  const factory = new IDBFactory()
  let storage = await HostSyncStorage.open(factory, 'sample-identity', app)
  // The host catches localStorage quota errors, leaving the prior value readable.
  const save = vi.spyOn(app, 'saveLocalStorage').mockImplementation(() => {})
  const fileHost = new ExternalFileHost(app as unknown as App, {
    platform: 'mobile',
    assertOwned: () => {},
  })
  try {
    const before = await fileHost.fingerprint('sample.bin')
    const identities = new TokenAttachmentHost(app as unknown as App)
    await identities.remember('sample.bin')
    const rows = storage.loadLocalStorage('abele-token-local-files-v1') as { id: string }[]
    const id = rows[0].id
    expect(identities.resolve(id)?.path).toBe('sample.bin')
    storage.close()
    storage = await HostSyncStorage.open(factory, 'sample-identity', app)
    expect(new TokenAttachmentHost(app as unknown as App).resolve(id)?.path).toBe('sample.bin')
    expect(await fileHost.fingerprint('sample.bin')).toEqual(before)
  } finally {
    fileHost.close()
    storage.close()
    save.mockRestore()
  }
})

function abortNextCommit() {
  const put = FakeObjectStore.prototype.put
  return vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementationOnce(function (
    this: FakeObjectStore,
    value,
    key
  ) {
    this.transaction.abort()
    return put.call(this, value, key)
  })
}

it.each(['remember', 'hydrated'] as const)(
  'persists identity after a failed %s commit and retry',
  async (operation) => {
    const app = buildFakeVault([{ path: 'sample.bin', content: 'sample bytes' }])
    const factory = new IDBFactory()
    let storage = await HostSyncStorage.open(factory, 'sample-retry', app)
    const host = new TokenAttachmentHost(app as unknown as App)
    try {
      if (operation === 'hydrated') {
        await host.remember('sample.bin')
        app.vault.getFileByPath('sample.bin')!.stat.ctime++
      }
      const abort = abortNextCommit()
      try {
        await expect(host[operation]('sample.bin')).rejects.toThrow()
      } finally {
        abort.mockRestore()
      }
      await host[operation]('sample.bin')
      const rows = storage.loadLocalStorage('abele-token-local-files-v1') as { id: string }[]
      const id = rows[0].id
      storage.close()
      storage = await HostSyncStorage.open(factory, 'sample-retry', app)
      expect(new TokenAttachmentHost(app as unknown as App).resolve(id)?.path).toBe('sample.bin')
    } finally {
      storage.close()
    }
  }
)

it('reports a failed rename commit and retains the committed path across restart', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'sample bytes' }])
  const factory = new IDBFactory()
  let storage = await HostSyncStorage.open(factory, 'sample-rename', app)
  const host = new TokenAttachmentHost(app as unknown as App)
  try {
    await host.remember('sample.bin')
    const id = (storage.loadLocalStorage('abele-token-local-files-v1') as { id: string }[])[0].id
    await app.vault.rename(app.vault.getFileByPath('sample.bin')!, 'renamed.bin')
    const abort = abortNextCommit()
    try {
      await expect(host.renamed('sample.bin', 'renamed.bin')).rejects.toThrow()
    } finally {
      abort.mockRestore()
    }
    expect(
      (storage.loadLocalStorage('abele-token-local-files-v1') as { path: string }[])[0].path
    ).toBe('sample.bin')
    storage.close()
    storage = await HostSyncStorage.open(factory, 'sample-rename', app)
    expect(
      (storage.loadLocalStorage('abele-token-local-files-v1') as { path: string }[])[0].path
    ).toBe('sample.bin')
    const restarted = new TokenAttachmentHost(app as unknown as App)
    expect(restarted.resolve(id)).toBeNull()
    await restarted.renamed('sample.bin', 'renamed.bin')
    storage.close()
    storage = await HostSyncStorage.open(factory, 'sample-rename', app)
    expect(new TokenAttachmentHost(app as unknown as App).resolve(id)?.path).toBe('renamed.bin')
  } finally {
    storage.close()
  }
})
