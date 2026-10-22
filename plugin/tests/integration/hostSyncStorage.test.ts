import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'
import { HostSyncStorage, prepareHostSyncStorage } from '@/sync/hostSyncStorage'
import { JOURNAL_KEY, WriteJournal } from '@/sync/writeJournal'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { buildFakeVault } from '../helpers/fakeVault'
import { sha256 } from '@abele/sync-sdk/core'
import { TokenConnectionRegistry, TOKEN_REGISTRY_KEY } from '@/sync/tokenConnectionRegistry'
import { deferred } from '../helpers/deferred'
import { prepareTokenConnections } from '@/sync/tokenRegistryPreparation'
import { recordTeardown } from '@/sync/teardownBarrier'
import { connectionJournalApp } from '@/sync/vaultPathLinks'

function local() {
  const data = new Map<string, unknown>()
  return {
    data,
    loadLocalStorage: (key: string) => structuredClone(data.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, structuredClone(value))
    },
  }
}

it('keeps committed host evidence when the last localStorage write disappears', async () => {
  const factory = new IDBFactory(),
    data = new Map<string, unknown>()
  const local = {
    loadLocalStorage: (key: string) => data.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, value)
    },
  }
  let store = await HostSyncStorage.open(factory, 'sample-vault', local)
  store.saveLocalStorage(JOURNAL_KEY, [{ target: 'sample.md', temp: 'sample.tmp' }])
  await store.flush()
  store.close()
  data.delete(JOURNAL_KEY)
  store = await HostSyncStorage.open(factory, 'sample-vault', local)
  expect(store.loadLocalStorage(JOURNAL_KEY)).toEqual([{ target: 'sample.md', temp: 'sample.tmp' }])
  store.close()
})

it('aborts migration as a whole and retries without losing legacy evidence', async () => {
  const factory = new IDBFactory(),
    storage = local()
  const entry = [{ target: 'sample.md', backup: 'sample.old' }]
  storage.saveLocalStorage(JOURNAL_KEY, entry)
  const put = FakeObjectStore.prototype.put
  const crash = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (
    this: FakeObjectStore,
    value,
    key
  ) {
    if (value.key === '!migrated') {
      this.transaction.abort()
      throw new Error('interrupted migration')
    }
    return put.call(this, value, key)
  })
  try {
    await expect(HostSyncStorage.open(factory, 'sample-vault', storage)).rejects.toThrow(
      'interrupted migration'
    )
    expect(storage.loadLocalStorage(JOURNAL_KEY)).toEqual(entry)
  } finally {
    crash.mockRestore()
  }
  storage.saveLocalStorage(JOURNAL_KEY, [...entry, { target: 'later.md', backup: 'later.old' }])
  const reopened = await HostSyncStorage.open(factory, 'sample-vault', storage)
  expect(reopened.loadLocalStorage(JOURNAL_KEY)).toHaveLength(2)
  reopened.close()
})

it('keeps migration authoritative when quit interrupts legacy mirroring after COMMIT', async () => {
  const factory = new IDBFactory(),
    storage = local()
  const entry = [{ target: 'sample.md', backup: 'sample.old' }]
  storage.saveLocalStorage(JOURNAL_KEY, entry)
  const crash = vi.spyOn(storage, 'saveLocalStorage').mockImplementation(() => {
    throw new Error('quit after commit')
  })
  await expect(HostSyncStorage.open(factory, 'sample-vault', storage)).rejects.toThrow(
    'quit after commit'
  )
  crash.mockRestore()
  storage.saveLocalStorage(JOURNAL_KEY, null)
  const reopened = await HostSyncStorage.open(factory, 'sample-vault', storage)
  expect(reopened.loadLocalStorage(JOURNAL_KEY)).toEqual(entry)
  reopened.close()
})

it('recovers ownership after quit between journal COMMIT and stage creation', async () => {
  const factory = new IDBFactory(),
    storage = local(),
    app = buildFakeVault([])
  let host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  let disk = new ObsidianFileSystem(app as never, { storage })
  let stageId = ''
  const crash = vi.spyOn(app.vault.adapter, 'writeBinary').mockImplementation(async (path) => {
    stageId = path
    expect(new WriteJournal(storage).entries()).toMatchObject([{ temp: path }])
    throw new Error('quit before file effect')
  })
  await expect(disk.beginAtomicWrite('sample.md', 0, null)).rejects.toThrow()
  crash.mockRestore()
  host.close()
  storage.data.clear()
  host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  disk = new ObsidianFileSystem(app as never, { storage })
  expect(new WriteJournal(storage).entries()).toMatchObject([{ temp: stageId }])
  expect(await app.vault.adapter.exists(stageId)).toBe(false)
  await disk.discardStage(stageId)
  expect(new WriteJournal(storage).entries()).toEqual([])
  host.close()
})

it('does not create a file when the host journal transaction aborts', async () => {
  const factory = new IDBFactory(),
    storage = local(),
    app = buildFakeVault([])
  const host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  const put = FakeObjectStore.prototype.put
  const crash = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (
    this: FakeObjectStore,
    value,
    key
  ) {
    if (value.key === JOURNAL_KEY) this.transaction.abort()
    return put.call(this, value, key)
  })
  const write = vi.spyOn(app.vault.adapter, 'writeBinary')
  try {
    await expect(
      new ObsidianFileSystem(app as never, { storage }).beginAtomicWrite('sample.md', 0, null)
    ).rejects.toThrow()
    expect(write).not.toHaveBeenCalled()
  } finally {
    crash.mockRestore()
    write.mockRestore()
    host.close()
  }
  const reopened = await HostSyncStorage.open(factory, 'sample-vault', storage)
  expect(reopened.loadLocalStorage(JOURNAL_KEY)).toBeNull()
  reopened.close()
})

it('retains installed evidence across an SDK rollback and retires it after ledger COMMIT', async () => {
  const factory = new IDBFactory(),
    storage = local(),
    app = buildFakeVault([])
  const host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  const state = await IndexedDbStateStore.open(factory, 'sample-ledger')
  const disk = new ObsidianFileSystem(app as never, { storage, ledger: state })
  state.observeCommittedEntries((entries) => disk.acknowledgeWrites(entries))
  const bytes = new TextEncoder().encode('sample bytes'),
    sha = await sha256(bytes)
  const stage = await disk.beginAtomicWrite('sample.md', 1000, null)
  await stage.append(0, bytes)
  await stage.seal({ size: bytes.length, sha })
  await stage.commit()
  const row = {
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'sample-version',
    sha,
    size: bytes.length,
    mtime: 1000,
  }
  expect(new WriteJournal(storage).entries()).toMatchObject([{ installed: true }])
  await expect(
    state.transaction(async () => {
      await state.put(row)
      await disk.recover()
      expect(new WriteJournal(storage).entries()).toMatchObject([{ installed: true }])
      throw new Error('rollback')
    })
  ).rejects.toThrow('rollback')
  expect(new WriteJournal(storage).entries()).toMatchObject([{ installed: true }])
  await state.put(row)
  expect(new WriteJournal(storage).entries()).toEqual([])
  const journal = new WriteJournal(storage)
  await journal.persist(() =>
    journal.add({
      target: row.path,
      temp: 'retired.tmp',
      replacementSha: sha,
      installed: true,
      retiredGeneration: 'sample-generation',
    })
  )
  await state.put(row)
  expect(journal.entries()).toMatchObject([{ retiredGeneration: 'sample-generation' }])
  expect(await app.vault.adapter.read('sample.md')).toBe('sample bytes')
  state.close()
  host.close()
})

it('persists registry enrollment and does not remove credentials before retirement COMMIT', async () => {
  const factory = new IDBFactory(),
    storage = local(),
    keys = new Map<string, string>()
  let host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  let registry = TokenConnectionRegistry.open(storage)
  const id = registry.add()
  const scope = { kind: 'folder' as const, id: 'sample-root', path: 'Notes' }
  const secrets = {
    get: (reference: string) => keys.get(reference) ?? null,
    set: (reference: string, value: string) => {
      keys.set(reference, value)
    },
    remove: vi.fn((reference: string) => {
      keys.delete(reference)
    }),
  }
  await registry.attachDurably(
    id,
    { v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope },
    { protocol: 2, token_id: 'sample-token', space_id: 'sample-space', scope, status: 'active' },
    secrets
  )
  host.close()
  storage.data.clear()
  host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  registry = TokenConnectionRegistry.open(storage)
  expect(registry.records().map((entry) => entry.id)).toEqual([id])
  registry.beginForget(id)
  const put = FakeObjectStore.prototype.put
  const crash = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (
    this: FakeObjectStore,
    value,
    key
  ) {
    if (value.key === TOKEN_REGISTRY_KEY) this.transaction.abort()
    return put.call(this, value, key)
  })
  try {
    await expect(registry.finishForgottenDurably(secrets, id)).rejects.toThrow()
    expect(secrets.remove).not.toHaveBeenCalled()
    expect(keys.size).toBe(1)
  } finally {
    crash.mockRestore()
    host.close()
  }
  host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  registry = TokenConnectionRegistry.open(storage)
  expect(registry.records().map((entry) => entry.id)).toEqual([id])
  host.close()
})

it('resumes keychain provisioning from a durably committed pending binding after quit', async () => {
  const factory = new IDBFactory(),
    storage = local(),
    keys = new Map<string, string>()
  let host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  let registry = TokenConnectionRegistry.open(storage)
  const id = registry.add()
  const scope = { kind: 'folder' as const, id: 'sample-root', path: 'Notes' }
  const token = { v: 1 as const, address: 'https://sync.example', key: 'a'.repeat(43), scope }
  const authority = {
    protocol: 2 as const,
    token_id: 'sample-token',
    space_id: 'sample-space',
    scope,
    status: 'active' as const,
  }
  const secrets = {
    get: (reference: string) => keys.get(reference) ?? null,
    set: vi.fn((reference: string, value: string) => {
      keys.set(reference, value)
      throw new Error('quit after keychain write')
    }),
  }
  await expect(registry.attachDurably(id, token, authority, secrets)).rejects.toThrow(
    'quit after keychain write'
  )
  host.close()
  storage.data.clear()
  host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  registry = TokenConnectionRegistry.open(storage)
  expect(registry.records()[0].pending?.secretReference).toBe([...keys.keys()][0])
  await registry.attachDurably(id, token, authority, secrets)
  expect(registry.records()[0].pending).toBeUndefined()
  expect(registry.records()[0].secretReference).toBe([...keys.keys()][0])
  expect(secrets.set).toHaveBeenCalledOnce()
  host.close()
})

it('does not recover a live write while its host journal commit is pending', async () => {
  const factory = new IDBFactory(),
    storage = local(),
    app = buildFakeVault([])
  const host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  const entered = deferred<void>(),
    release = deferred<void>()
  const flush = host.flush.bind(host)
  const blocked = vi.spyOn(host, 'flush').mockImplementation(async () => {
    entered.resolve()
    await release.promise
    await flush()
  })
  const disk = new ObsidianFileSystem(app as never, { storage })
  const writing = disk.writeAtomic('sample.md', new TextEncoder().encode('sample bytes'), 0)
  let recovering: Promise<void> | undefined
  try {
    await entered.promise
    recovering = disk.recover()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(new WriteJournal(storage).entries()).toMatchObject([{ target: 'sample.md' }])
  } finally {
    release.resolve()
    await Promise.all([writing, recovering])
    blocked.mockRestore()
    host.close()
  }
})

it('hydrates replacement storage only after the previous host has closed', async () => {
  const factory = new IDBFactory(),
    storage = local()
  const app = Object.assign(storage, { appId: 'sample-vault' }) as never
  const old = await prepareHostSyncStorage(app, factory)
  const release = deferred<void>()
  recordTeardown(
    app,
    release.promise.then(() => old.close())
  )
  let ready = false
  const preparing = prepareTokenConnections(
    app,
    { get: () => '', remove() {} },
    undefined,
    factory
  ).then((registry) => {
    ready = true
    return registry
  })
  await Promise.resolve()
  expect(ready).toBe(false)
  release.resolve()
  const registry = await preparing
  const id = registry.add()
  await registry.flush()
  const replacement = await prepareHostSyncStorage(app, factory)
  expect(replacement).not.toBe(old)
  expect(registry.records().map((entry) => entry.id)).toEqual([id])
  replacement.close()
})

it('keeps connection-bound adapter journals on the durable host across reopen', async () => {
  const factory = new IDBFactory(),
    app = buildFakeVault([])
  let host = await HostSyncStorage.open(factory, 'sample-vault', app)
  const scoped = connectionJournalApp(app as never, 'sample-owner')
  const disk = () => new ObsidianFileSystem(scoped, { journalOwner: 'sample-owner' })
  const stage = await disk().beginAtomicWrite('sample.md', 0, null)
  await stage.append(0, new TextEncoder().encode('sample bytes'))
  host.close()
  app.saveLocalStorage(JOURNAL_KEY, null)
  host = await HostSyncStorage.open(factory, 'sample-vault', app)
  expect((await disk().reopenStage(stage.id)).offset).toBe(12)
  await disk().discardStage(stage.id)
  host.close()
})
