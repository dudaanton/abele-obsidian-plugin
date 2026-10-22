import { expect, it, vi } from 'vitest'
import {
  IDBFactory,
  IDBObjectStore as FakeObjectStore,
  IDBIndex as FakeIndex,
} from 'fake-indexeddb'
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

it('isolates journal inventories and indexed reads for similar namespace prefixes', async () => {
  const factory = new IDBFactory()
  const a = await HostSyncStorage.open(factory, 'sample-prefix', local())
  const b = await HostSyncStorage.open(factory, 'sample-prefix-extra', local())
  const first = new WriteJournal(a),
    second = new WriteJournal(b)
  const x = { target: 'first.md', temp: 'sample.tmp' },
    y = { target: 'second.md', temp: 'sample.tmp' }
  try {
    await first.persist(() => first.add(x))
    await second.persist(() => second.add(y))
    expect(await first.currentEntries()).toEqual([x])
    expect(await second.currentEntries()).toEqual([y])
    expect(await first.currentEntry(x.temp)).toEqual(x)
    expect(await second.currentEntry(y.temp)).toEqual(y)
  } finally {
    a.close()
    b.close()
  }
})

it('reads another host additions and retirements at journal decision time', async () => {
  const factory = new IDBFactory()
  const a = await HostSyncStorage.open(factory, 'sample-decisions', local())
  const b = await HostSyncStorage.open(factory, 'sample-decisions', local())
  const writer = new WriteJournal(a),
    reader = new WriteJournal(b)
  const entry = { target: 'sample.md', temp: 'sample.tmp' }
  try {
    await writer.persist(() => writer.add(entry))
    expect(await reader.currentEntry(entry.temp)).toEqual(entry)
    expect(await reader.currentEntries()).toEqual([entry])
    await writer.persist(() => writer.drop(entry))
    expect(await reader.currentEntry(entry.temp)).toBeUndefined()
    expect(await reader.currentEntries()).toEqual([])
  } finally {
    a.close()
    b.close()
  }
})

it('invalidates failed work even when another write is already queued', async () => {
  const factory = new IDBFactory()
  const a = await HostSyncStorage.open(factory, 'sample-failed-queue', local())
  const x = { target: 'old.md', temp: 'old.tmp' },
    y = { target: 'failed.md', temp: 'failed.tmp' },
    z = { target: 'queued.md', temp: 'queued.tmp' }
  a.saveLocalStorage(JOURNAL_KEY, [x])
  await a.flush()
  const b = await HostSyncStorage.open(factory, 'sample-failed-queue', local())
  a.saveLocalStorage(JOURNAL_KEY, [])
  await a.flush()
  const put = FakeObjectStore.prototype.put
  const abort = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementationOnce(function (
    this: FakeObjectStore,
    value,
    key
  ) {
    this.transaction.abort()
    return put.call(this, value, key)
  })
  try {
    b.saveLocalStorage(JOURNAL_KEY, [x, y])
    const failed = expect(b.flush()).rejects.toThrow()
    b.saveLocalStorage(JOURNAL_KEY, [x, y, z])
    const queued = b.flush()
    await failed
    await queued
    expect(await new WriteJournal(b).currentEntries()).toEqual([z])
    expect(await new WriteJournal(b).currentEntry(x.temp)).toBeUndefined()
  } finally {
    abort.mockRestore()
    a.close()
    b.close()
  }
})

it('rejects a stale journal transition after another host retires its generation', async () => {
  const factory = new IDBFactory()
  const a = await HostSyncStorage.open(factory, 'sample-transition', local())
  const b = await HostSyncStorage.open(factory, 'sample-transition', local())
  const first = new WriteJournal(a),
    second = new WriteJournal(b)
  const entry = { target: 'sample.md', temp: 'sample.tmp' }
  try {
    await first.persist(() => first.add(entry))
    await first.persist(() =>
      first.replace(entry, { ...entry, retiredGeneration: 'sample-generation' })
    )
    await expect(
      second.persist(() => second.replace(entry, { ...entry, installed: true }))
    ).rejects.toThrow()
    expect(await first.currentEntry(entry.temp)).toEqual({
      ...entry,
      retiredGeneration: 'sample-generation',
    })
  } finally {
    a.close()
    b.close()
  }
})

it('allocates a fresh order when removing and readding in one transaction', async () => {
  const factory = new IDBFactory()
  const a = await HostSyncStorage.open(factory, 'sample-readd', local())
  const x = { target: 'first.md', temp: 'first.tmp' },
    y = { target: 'second.md', temp: 'second.tmp' }
  a.saveLocalStorage(JOURNAL_KEY, [x, y])
  await a.flush()
  const b = await HostSyncStorage.open(factory, 'sample-readd', local())
  try {
    a.saveLocalStorage(JOURNAL_KEY, [y])
    a.saveLocalStorage(JOURNAL_KEY, [y, x])
    await a.flush()
    const reader = await HostSyncStorage.open(factory, 'sample-readd', local())
    expect(reader.loadLocalStorage(JOURNAL_KEY)).toEqual([y, x])
    reader.close()
    expect(await new WriteJournal(b).currentEntries()).toEqual([y, x])
  } finally {
    a.close()
    b.close()
  }
})

it('checks durable stage ownership after another host retires the entry', async () => {
  const factory = new IDBFactory(),
    app = buildFakeVault([])
  const a = await HostSyncStorage.open(factory, 'sample-stage-owners', local())
  const b = await HostSyncStorage.open(factory, 'sample-stage-owners', local())
  const writer = new ObsidianFileSystem(app as never, { storage: a })
  const reader = new ObsidianFileSystem(app as never, { storage: b })
  try {
    const stage = await writer.beginAtomicWrite('sample.md', 0, null)
    const opened = await reader.reopenStage(stage.id)
    const journal = new WriteJournal(a)
    const entry = await journal.currentEntry(stage.id)
    expect(entry).toBeDefined()
    await journal.persist(() => journal.drop(entry!))
    await expect(reader.reopenStage(stage.id)).rejects.toThrow()
    await expect(reader.discardStage(stage.id)).rejects.toThrow()
    await expect(opened.append(0, new Uint8Array([1]))).rejects.toThrow()
    expect(await app.vault.adapter.exists(stage.id)).toBe(true)
    expect((await app.vault.adapter.stat(stage.id))?.size).toBe(0)
  } finally {
    a.close()
    b.close()
  }
})

it('does not retire an unrelated entry when persisting from an outdated journal hint', async () => {
  const factory = new IDBFactory()
  const a = await HostSyncStorage.open(factory, 'sample-hint', local())
  const b = await HostSyncStorage.open(factory, 'sample-hint', local())
  const first = new WriteJournal(a),
    second = new WriteJournal(b)
  const x = { target: 'first.md', temp: 'first.tmp' },
    y = { target: 'second.md', temp: 'second.tmp' }
  try {
    await first.persist(() => first.add(x))
    await second.persist(() => second.add(y))
    await second.persist(() => second.drop(x))
    expect(await first.currentEntries()).toEqual([y])
    expect(await first.currentForTargets([x.target])).toEqual([])
    expect(await first.currentForTargets([y.target])).toEqual([y])
  } finally {
    a.close()
    b.close()
  }
})

it('acknowledges one target without enumerating unrelated journal records', async () => {
  const seed = local(),
    app = buildFakeVault([])
  const entries = Array.from({ length: 100 }, (_, index) => ({
    target: `sample-${index}.md`,
    temp: `sample-${index}.tmp`,
    installed: true,
    replacementSha: 'a'.repeat(64),
  }))
  seed.saveLocalStorage(JOURNAL_KEY, entries)
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-target-lookup', seed)
  const getAll = FakeIndex.prototype.getAll
  const cursor = vi.spyOn(FakeObjectStore.prototype, 'openCursor').mockImplementation(() => {
    throw new Error('Unrelated journal enumeration')
  })
  const scan = vi.spyOn(FakeIndex.prototype, 'getAll').mockImplementation(function (
    this: FakeIndex,
    ...args
  ) {
    if (this.name === 'group') throw new Error('Unrelated journal enumeration')
    return getAll.apply(this, args)
  })
  try {
    const fs = new ObsidianFileSystem(app as never, { storage: host })
    await fs.acknowledgeWrites([
      {
        path: entries[0].target,
        wirePath: entries[0].target,
        fileId: 'sample-file',
        versionId: 'sample-version',
        sha: entries[0].replacementSha,
        size: 0,
        mtime: 0,
      },
    ])
    expect(await new WriteJournal(host).currentEntry(entries[0].temp)).toBeUndefined()
    expect(await new WriteJournal(host).currentEntry(entries[1].temp)).toEqual(entries[1])
  } finally {
    scan.mockRestore()
    cursor.mockRestore()
    host.close()
  }
})

it('retires 5000 journal entries with linear IndexedDB record reads', async () => {
  const seed = local()
  const entries = Array.from({ length: 5000 }, (_, i) => ({
    target: `sample-${i}.md`,
    temp: `sample-${i}.tmp`,
  }))
  seed.saveLocalStorage(JOURNAL_KEY, entries)
  const factory = new IDBFactory()
  const host = await HostSyncStorage.open(factory, 'sample-cost', seed)
  let touched = 0
  const all = FakeIndex.prototype.getAll
  const get = FakeObjectStore.prototype.get
  const put = FakeObjectStore.prototype.put
  const remove = FakeObjectStore.prototype.delete
  const openCursor = FakeObjectStore.prototype.openCursor
  const cursor = vi.spyOn(FakeObjectStore.prototype, 'openCursor').mockImplementation(function (
    this: FakeObjectStore,
    ...args
  ) {
    const request = openCursor.apply(this, args)
    request.addEventListener('success', () => {
      if (request.result) touched++
    })
    return request
  })
  const write = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (
    this: FakeObjectStore,
    ...args
  ) {
    touched++
    return put.apply(this, args)
  })
  const erase = vi.spyOn(FakeObjectStore.prototype, 'delete').mockImplementation(function (
    this: FakeObjectStore,
    ...args
  ) {
    touched++
    return remove.apply(this, args)
  })
  const scan = vi.spyOn(FakeIndex.prototype, 'getAll').mockImplementation(function (
    this: FakeIndex,
    ...args
  ) {
    const request = all.apply(this, args)
    request.addEventListener('success', () => {
      touched += request.result.length
    })
    return request
  })
  const read = vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(function (
    this: FakeObjectStore,
    ...args
  ) {
    touched++
    return get.apply(this, args)
  })
  try {
    for (let i = 1; i <= entries.length; i++) {
      host.saveLocalStorage(JOURNAL_KEY, entries.slice(i))
      await host.flush()
      expect(touched).toBeLessThanOrEqual(entries.length * 4)
    }
    expect(touched).toBeLessThanOrEqual(entries.length * 4)
    expect(scan).not.toHaveBeenCalled()
    expect(host.loadLocalStorage(JOURNAL_KEY)).toEqual([])
  } finally {
    scan.mockRestore()
    read.mockRestore()
    write.mockRestore()
    erase.mockRestore()
    cursor.mockRestore()
    host.close()
  }
  const reopened = await HostSyncStorage.open(factory, 'sample-cost', local())
  expect(reopened.loadLocalStorage(JOURNAL_KEY)).toEqual([])
  reopened.close()
}, 120000)

it('initializes the append counter when reopening records written by earlier schema-2 hosts', async () => {
  const factory = new IDBFactory()
  const seed = local()
  const first = { target: 'first.md', temp: 'first.tmp' }
  const second = { target: 'second.md', temp: 'second.tmp' }
  seed.saveLocalStorage(JOURNAL_KEY, [first, second])
  const host = await HostSyncStorage.open(factory, 'sample-order', seed)
  host.close()
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('abele-sync-host-v1')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('host-records-v3', 'readwrite')
    tx.objectStore('host-records-v3').put({
      keyId: JSON.stringify(['sample-order', JOURNAL_KEY, '!header']),
      namespace: 'sample-order',
      key: JOURNAL_KEY,
      id: '!header',
      value: { kind: 'array' },
      order: -1,
    })
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
  const writer = await HostSyncStorage.open(factory, 'sample-order', local())
  const third = { target: 'third.md', temp: 'third.tmp' }
  writer.saveLocalStorage(JOURNAL_KEY, [first, second, third])
  await writer.flush()
  writer.close()
  const reader = await HostSyncStorage.open(factory, 'sample-order', local())
  expect(reader.loadLocalStorage(JOURNAL_KEY)).toEqual([first, second, third])
  reader.close()
})

it('merges independent journal entries from two hydrated hosts without resurrecting retired work', async () => {
  const factory = new IDBFactory(),
    firstLocal = local(),
    secondLocal = local()
  const first = await HostSyncStorage.open(factory, 'sample-concurrent', firstLocal)
  const second = await HostSyncStorage.open(factory, 'sample-concurrent', secondLocal)
  const x = { target: 'first.md', temp: 'first.tmp' },
    y = { target: 'second.md', temp: 'second.tmp' }
  first.saveLocalStorage(JOURNAL_KEY, [x])
  await first.flush()
  second.saveLocalStorage(JOURNAL_KEY, [y])
  await second.flush()
  const combined = await HostSyncStorage.open(factory, 'sample-concurrent', local())
  expect(combined.loadLocalStorage(JOURNAL_KEY)).toEqual([x, y])
  combined.close()
  first.saveLocalStorage(JOURNAL_KEY, null)
  await first.flush()
  second.saveLocalStorage(JOURNAL_KEY, [y, { target: 'third.md', temp: 'third.tmp' }])
  await second.flush()
  const reopened = await HostSyncStorage.open(factory, 'sample-concurrent', local())
  expect(reopened.loadLocalStorage(JOURNAL_KEY)).toEqual([
    y,
    { target: 'third.md', temp: 'third.tmp' },
  ])
  first.close()
  second.close()
  reopened.close()
})

it.each([false, true])(
  'preserves concurrent registry enrollments and rejects a stale update to a retired record (item=%s)',
  async (item) => {
    const factory = new IDBFactory()
    const first = await HostSyncStorage.open(factory, 'sample-concurrent', local())
    const second = await HostSyncStorage.open(factory, 'sample-concurrent', local())
    const a = TokenConnectionRegistry.open(first),
      b = TokenConnectionRegistry.open(second)
    const x = a.add(item),
      y = b.add(item)
    await expect(a.flush(), 'first enrollment').resolves.toBeUndefined()
    await expect(b.flush(), 'second enrollment').resolves.toBeUndefined()
    const reader = await HostSyncStorage.open(factory, 'sample-concurrent', local())
    expect(
      TokenConnectionRegistry.open(reader)
        .records()
        .map((entry) => entry.id)
    ).toEqual([x, y])
    a.beginForget(x)
    await expect(a.flush(), 'retirement').resolves.toBeUndefined()
    b.setPaused(x, true)
    await expect(b.flush()).rejects.toThrow()
    const reopened = await HostSyncStorage.open(factory, 'sample-concurrent', local())
    expect(
      TokenConnectionRegistry.open(reopened)
        .records()
        .map((entry) => entry.id)
    ).toEqual([y])
    const z = b.add(item)
    await expect(b.flush(), 'enrollment after conflict').resolves.toBeUndefined()
    const latest = await HostSyncStorage.open(factory, 'sample-concurrent', local())
    expect(
      TokenConnectionRegistry.open(latest)
        .records()
        .map((entry) => entry.id)
    ).toEqual([y, z])
    latest.close()
    first.close()
    second.close()
    reader.close()
    reopened.close()
  }
)

it('reports an aborted transaction but allows a later independent write to commit', async () => {
  const factory = new IDBFactory(),
    storage = local()
  const host = await HostSyncStorage.open(factory, 'sample-retry', storage)
  const put = FakeObjectStore.prototype.put
  const abort = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementationOnce(function (
    this: FakeObjectStore,
    value,
    key
  ) {
    this.transaction.abort()
    return put.call(this, value, key)
  })
  host.saveLocalStorage(JOURNAL_KEY, [{ target: 'failed.md', temp: 'failed.tmp' }])
  await expect(host.flush()).rejects.toThrow()
  abort.mockRestore()
  await expect(host.flush()).resolves.toBeUndefined()
  host.saveLocalStorage(JOURNAL_KEY, [{ target: 'later.md', temp: 'later.tmp' }])
  await expect(host.flush()).resolves.toBeUndefined()
  const reopened = await HostSyncStorage.open(factory, 'sample-retry', local())
  expect(reopened.loadLocalStorage(JOURNAL_KEY)).toEqual([
    { target: 'later.md', temp: 'later.tmp' },
  ])
  host.close()
  reopened.close()
})

it('retries an interrupted schema-two path-index migration without losing evidence', async () => {
  const factory = new IDBFactory(),
    namespace = 'sample-index-upgrade'
  const entry = { target: 'sample.md', temp: 'sample.tmp' }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('abele-sync-host-v1', 2)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('host', { keyPath: ['namespace', 'key'] })
      request.result
        .createObjectStore('host-records', { keyPath: ['namespace', 'key', 'id'] })
        .createIndex('group', ['namespace', 'key'])
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const tx = db.transaction(['host', 'host-records'], 'readwrite')
  for (const key of [
    JOURNAL_KEY,
    'abele-sync-recovered-writes',
    TOKEN_REGISTRY_KEY,
    'abele-sync-item-connections-v1',
    'abele-sync-item-selection-v1',
    'abele-sync-registry-write-v1',
    'abele-sync-connection-sets-v1',
  ]) {
    tx.objectStore('host').put({ namespace, key, value: key === JOURNAL_KEY ? [entry] : null })
    tx.objectStore('host-records').put({
      namespace,
      key,
      id: '!header',
      order: 1,
      value: key === JOURNAL_KEY ? { kind: 'array' } : { kind: 'value', value: null },
    })
  }
  tx.objectStore('host-records').put({
    namespace,
    key: JOURNAL_KEY,
    id: 'entry:[null,"sample.tmp"]',
    order: 0,
    value: entry,
  })
  for (const key of ['!migrated', '!records-migrated'])
    tx.objectStore('host').put({ namespace, key, value: true })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
  const put = FakeObjectStore.prototype.put
  const abort = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (
    this: FakeObjectStore,
    value,
    key
  ) {
    if (value.key === '!paths-migrated') {
      this.transaction.abort()
      throw new Error('Interrupted index migration')
    }
    return put.call(this, value, key)
  })
  try {
    await expect(HostSyncStorage.open(factory, namespace, local())).rejects.toThrow(
      'Interrupted index migration'
    )
  } finally {
    abort.mockRestore()
  }
  const host = await HostSyncStorage.open(factory, namespace, local())
  try {
    const journal = new WriteJournal(host)
    expect(await journal.currentEntry(entry.temp)).toEqual(entry)
    expect(await journal.currentForTargets([entry.target])).toEqual([entry])
    await journal.persist(() => journal.drop(entry))
    expect(await journal.currentEntry(entry.temp)).toBeUndefined()
  } finally {
    host.close()
  }
})

it('migrates committed version-one host values to records once without resurrecting deleted entries', async () => {
  const factory = new IDBFactory(),
    namespace = 'sample-upgrade'
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = factory.open('abele-sync-host-v1', 1)
    opening.onupgradeneeded = () =>
      opening.result.createObjectStore('host', { keyPath: ['namespace', 'key'] })
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(opening.error)
  })
  const legacy = [{ target: 'legacy.md', temp: 'legacy.tmp' }]
  const tx = db.transaction('host', 'readwrite')
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  for (const key of [
    JOURNAL_KEY,
    'abele-sync-recovered-writes',
    TOKEN_REGISTRY_KEY,
    'abele-sync-item-connections-v1',
    'abele-sync-item-selection-v1',
    'abele-sync-registry-write-v1',
    'abele-sync-connection-sets-v1',
  ])
    tx.objectStore('host').put({ namespace, key, value: key === JOURNAL_KEY ? legacy : null })
  tx.objectStore('host').put({ namespace, key: '!migrated', value: true })
  await committed
  db.close()
  const put = FakeObjectStore.prototype.put
  const interrupted = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (
    this: FakeObjectStore,
    value,
    key
  ) {
    if (value.key === '!records-migrated') {
      this.transaction.abort()
      throw new Error('interrupted record migration')
    }
    return put.call(this, value, key)
  })
  await expect(HostSyncStorage.open(factory, namespace, local())).rejects.toThrow(
    'interrupted record migration'
  )
  interrupted.mockRestore()
  const upgraded = await HostSyncStorage.open(factory, namespace, local())
  expect(upgraded.loadLocalStorage(JOURNAL_KEY)).toEqual(legacy)
  upgraded.saveLocalStorage(JOURNAL_KEY, null)
  await upgraded.flush()
  upgraded.close()
  const reopened = await HostSyncStorage.open(factory, namespace, local())
  expect(reopened.loadLocalStorage(JOURNAL_KEY)).toBeNull()
  reopened.close()
})

it('commits independent work already queued behind an aborted transaction', async () => {
  const factory = new IDBFactory()
  const host = await HostSyncStorage.open(factory, 'sample-queued', local())
  const put = FakeObjectStore.prototype.put
  const abort = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementationOnce(function (
    this: FakeObjectStore,
    value,
    key
  ) {
    this.transaction.abort()
    return put.call(this, value, key)
  })
  const failed = { target: 'failed.md', temp: 'failed.tmp' },
    later = { target: 'later.md', temp: 'later.tmp' }
  host.saveLocalStorage(JOURNAL_KEY, [failed])
  const rejected = expect(host.flush()).rejects.toThrow()
  host.saveLocalStorage(JOURNAL_KEY, [failed, later])
  const queued = host.flush()
  try {
    await rejected
    await expect(queued).resolves.toBeUndefined()
  } finally {
    abort.mockRestore()
  }
  const reopened = await HostSyncStorage.open(factory, 'sample-queued', local())
  expect(reopened.loadLocalStorage(JOURNAL_KEY)).toEqual([later])
  reopened.saveLocalStorage(JOURNAL_KEY, [])
  await reopened.flush()
  expect(reopened.loadLocalStorage(JOURNAL_KEY)).toEqual([])
  host.close()
  reopened.close()
})

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
