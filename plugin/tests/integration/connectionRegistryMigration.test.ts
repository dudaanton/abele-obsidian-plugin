import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Journal, StateEntry } from '@abele/sync-core'
import { ConnectionRegistry } from '@/sync/connectionRegistry'
import { emptyConnection, readConnection, writeConnection } from '@/sync/connection'
import { readLedgerId, type LocalStorage } from '@/sync/ledgerId'
import { IndexedDbStateStore, stateDatabaseName } from '@/sync/IndexedDbStateStore'
import { bindDeviceToken, boundDeviceToken } from '@/secrets/deviceSecret'
import { connectionAppFor, prepareConnectionApp } from '@/sync/connectionApp'
import { Enrolment } from '@/sync/enrolment'
import { useVault } from '../helpers/testEnv'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import type { App } from 'obsidian'

it('reopens the same ledger with its checkpoint, base and unfinished commit after migration', async () => {
  const factory = new IDBFactory()
  const values = new Map<string, unknown>()
  const storage: LocalStorage = {
    loadLocalStorage: (key) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key, value) => {
      values.set(key, structuredClone(value))
    },
  }
  const connection = {
    ...emptyConnection(),
    serverUrl: 'https://sync.example.test',
    enrolledUrl: 'https://sync.example.test',
    vaultId: 'sample-vault',
    deviceId: 'sample-device',
    deviceTokenId: 'abele-sync-device-original',
    join: { vaultId: 'sample-vault', prefer: 'theirs' as const, ask: false },
  }
  storage.saveLocalStorage('abele-sync-connection', connection)
  storage.saveLocalStorage('abele-sync-ledger', {
    stateId: 'original-ledger',
    vaultId: connection.vaultId,
  })
  const secretValues = new Map<string, string>()
  const secrets = {
    get: (id: string) => secretValues.get(id) ?? '',
    set: (id: string, value: string) => {
      secretValues.set(id, value)
    },
  }
  bindDeviceToken(secrets, connection.deviceTokenId, 'sample-device-token', connection.serverUrl)
  const savedSecrets = [...secretValues]
  const entry: StateEntry = {
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'sample-version',
    sha: 'a'.repeat(64),
    size: 12,
    mtime: 1000,
  }
  const journal: Journal = {
    batchId: 'sample-batch',
    idempotencyKey: 'original-request',
    startedAt: '2025-01-01T00:00:00Z',
    ops: [{ op: 'delete', file_id: entry.fileId, base_version_id: entry.versionId }],
  }
  const old = await IndexedDbStateStore.open(factory, stateDatabaseName('original-ledger'))
  await old.put(entry)
  await old.setCursor(42)
  await old.setJournal(journal)
  await old.setMeta('sample-scope-checkpoint', 'original-checkpoint')
  old.close()

  const migrated = ConnectionRegistry.open(storage)
  const restarted = ConnectionRegistry.open(storage)
  expect(restarted.selectedId).toBe(migrated.selectedId)
  const view = restarted.storage(restarted.selectedId)
  expect(readConnection(view)).toEqual(connection)
  expect(boundDeviceToken(secrets, readConnection(view).deviceTokenId, connection.serverUrl)).toBe(
    'sample-device-token'
  )
  expect([...secretValues]).toEqual(savedSecrets)
  const resumed = await IndexedDbStateStore.open(
    factory,
    stateDatabaseName(readLedgerId(view).stateId)
  )
  try {
    expect(await resumed.get(entry.path)).toEqual(entry)
    expect(await resumed.getCursor()).toBe(42)
    expect(await resumed.getJournal()).toEqual(journal)
    expect(await resumed.getMeta('sample-scope-checkpoint')).toBe('original-checkpoint')
  } finally {
    resumed.close()
  }
})

it('forgets one connection through existing enrolment without removing the other ledger or credential', async () => {
  const original = useVault([]) as unknown as App
  setSecrets(null)
  const a = await prepareConnectionApp(original)
  const registry = ConnectionRegistry.open(original)
  const b = connectionAppFor(original, registry.add('personal'))
  const factory = new IDBFactory()
  for (const [view, id, endpoint] of [
    [a, 'ledger-one', 'https://one.example.test'],
    [b, 'ledger-two', 'https://two.example.test'],
  ] as const) {
    view.saveLocalStorage('abele-sync-ledger', { stateId: id, vaultId: 'same-vault' })
    writeConnection(view, {
      ...emptyConnection(),
      serverUrl: endpoint,
      enrolledUrl: endpoint,
      vaultId: 'same-vault',
      deviceId: id,
      deviceTokenId: 'abele-sync-device-' + id,
    })
    const store = await IndexedDbStateStore.open(factory, stateDatabaseName(id))
    await store.setCursor(17)
    store.close()
  }
  const otherConnection = readConnection(b)
  bindDeviceToken(
    secrets().device,
    otherConnection.deviceTokenId,
    'other-device-token',
    otherConnection.serverUrl
  )
  const transport = vi.fn()
  const enrolment = new Enrolment({
    app: () => a,
    factory: () => factory,
    transport: () => transport,
    note: () => {},
    connection: () => readConnection(a),
    saveConnection: (patch) => writeConnection(a, { ...readConnection(a), ...patch }),
    serialise: (work) => work(),
    teardown: async () => {},
    reconcile: async () => {},
  })
  await enrolment.forget()
  expect(readLedgerId(a).stateId).toBe('')
  expect(readLedgerId(b).stateId).toBe('ledger-two')
  expect(readConnection(b)).toEqual(otherConnection)
  expect(
    boundDeviceToken(secrets().device, otherConnection.deviceTokenId, otherConnection.serverUrl)
  ).toBe('other-device-token')
  expect((await factory.databases()).map((db) => db.name)).toEqual([
    stateDatabaseName('ledger-two'),
  ])
  const store = await IndexedDbStateStore.open(factory, stateDatabaseName('ledger-two'))
  try {
    expect(await store.getCursor()).toBe(17)
  } finally {
    store.close()
  }
  expect(transport).not.toHaveBeenCalled()
})
