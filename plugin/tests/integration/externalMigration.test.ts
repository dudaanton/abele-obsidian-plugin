// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbStateStore, stateDatabaseName } from '@/sync/IndexedDbStateStore'
import {
  activateExternalFiles,
  checkExternalMigration,
  inspectExistingLedger,
} from '@/sync/external/pluginSafety'
import { EXTERNAL_ACTIVATION_KEY, EXTERNAL_SWITCH_KEY } from '@/sync/external/recovery'
import { buildFakeVault } from '../helpers/fakeVault'

const binding = {
  endpoint: 'https://sync.example.invalid',
  vaultId: 'sample-vault',
  mode: 'personal' as const,
  principalId: 'sample-device',
  principalType: 'device' as const,
  grantId: null,
  generation: 1,
  credentialAssociation: 'sample-slot',
}
const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) fn()
})
function oldOpen(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, 1)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
it('upgrades the real version-1 ledger without losing rows, then refuses old normal startup', async () => {
  const factory = new IDBFactory(),
    name = stateDatabaseName('sample-ledger')
  const old = await oldOpen(factory, name)
  // A synthetic version-1 schema, as shipped before activation.
  old.close()
  await IndexedDbStateStore.delete(factory, name)
  const r = factory.open(name, 1)
  await new Promise<void>((resolve, reject) => {
    r.onupgradeneeded = () => {
      const e = r.result.createObjectStore('entries', { keyPath: 'path' })
      e.createIndex('byFileId', 'fileId')
      e.createIndex('byWirePath', 'wirePath')
      r.result.createObjectStore('meta', { keyPath: 'key' })
    }
    r.onerror = () => reject(r.error)
    r.onsuccess = () => resolve()
  })
  const db = r.result
  const tx = db.transaction('meta', 'readwrite')
  tx.objectStore('meta').put({ key: 'plugin:sample-retained', value: 'sample-value' })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
  const store = await IndexedDbStateStore.open(factory, name)
  cleanup.push(() => store.close())
  expect(await store.getMeta('sample-retained')).toBe('sample-value')
  const app = buildFakeVault([])
  await activateExternalFiles(app as never, store, 'sample-ledger', name, binding, () => {})
  store.close()
  await expect(oldOpen(factory, name)).rejects.toMatchObject({ name: 'VersionError' })
  expect((await inspectExistingLedger(factory, name))?.version).toBe(2)
})
it('old direct database deletion is still possible, but its surviving activation marker forbids new bootstrap', async () => {
  const factory = new IDBFactory(),
    name = stateDatabaseName('sample-ledger'),
    app = buildFakeVault([])
  const store = await IndexedDbStateStore.open(factory, name)
  await activateExternalFiles(app as never, store, 'sample-ledger', name, binding, () => {})
  const marker = app.loadLocalStorage(EXTERNAL_ACTIVATION_KEY)
  store.close()
  // Deliberately demonstrate the unsupported old Forget boundary, not a new lifecycle bypass.
  await new Promise<void>((resolve, reject) => {
    const r = factory.deleteDatabase(name)
    r.onsuccess = () => resolve()
    r.onerror = () => reject(r.error)
  })
  expect(app.loadLocalStorage(EXTERNAL_ACTIVATION_KEY)).toEqual(marker)
  await expect(checkExternalMigration(app as never, factory)).rejects.toThrow(
    /missing|bootstrap|external/i
  )
  expect(await factory.databases()).toEqual([])
})
it('an interrupted activation stays preparing and can resume only in the same database instance', async () => {
  const factory = new IDBFactory(),
    name = stateDatabaseName('sample-ledger'),
    app = buildFakeVault([])
  const store = await IndexedDbStateStore.open(factory, name)
  cleanup.push(() => store.close())
  const commit = vi
    .spyOn(store, 'commitExternalPhase')
    .mockRejectedValueOnce(new Error('sample interrupted initialization'))
  await expect(
    activateExternalFiles(app as never, store, 'sample-ledger', name, binding, () => {})
  ).rejects.toThrow()
  expect((app.loadLocalStorage(EXTERNAL_ACTIVATION_KEY) as any).ledgers[0].phase).toBe('preparing')
  commit.mockRestore()
  await activateExternalFiles(app as never, store, 'sample-ledger', name, binding, () => {})
  expect((app.loadLocalStorage(EXTERNAL_ACTIVATION_KEY) as any).ledgers[0].phase).toBe('active')
  expect(await store.getExternalState()).not.toBeNull()
  store.close()
  await IndexedDbStateStore.delete(factory, name)
  const replacement = await IndexedDbStateStore.open(factory, name)
  cleanup.push(() => replacement.close())
  await expect(
    activateExternalFiles(app as never, replacement, 'sample-ledger', name, binding, () => {})
  ).rejects.toThrow(/binding|external/i)
  expect(await replacement.getExternalState()).toBeNull()
})
it('connection-switch evidence is a recovery hold, not permission for a fresh join', async () => {
  const app = buildFakeVault([])
  app.saveLocalStorage(EXTERNAL_SWITCH_KEY, { interrupted: true })
  await expect(checkExternalMigration(app as never, new IDBFactory())).rejects.toThrow(
    /replacement|external/i
  )
})
