import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { DurableTokenSecrets } from '@/sync/durableTokenSecrets'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { HostSyncStorage } from '@/sync/hostSyncStorage'

const token = {
  v: 1 as const,
  address: 'https://sync.example',
  key: 'a'.repeat(43),
  scope: { kind: 'folder' as const, id: 'sample', path: 'Sample' },
}
const authority = {
  protocol: 2 as const,
  token_id: 'sample-token',
  space_id: 'sample-space',
  scope: token.scope,
  status: 'active' as const,
}

function volatileHost() {
  const committed = new Map<string, string>()
  let draft = new Map(committed)
  return {
    get: (id: string) => draft.get(id) ?? null,
    set: (id: string, value: string) => { draft.set(id, value) },
    remove: (id: string) => { draft.delete(id) },
    crash: () => { draft = new Map(committed) },
  }
}

vi.stubGlobal('IDBKeyRange', IDBKeyRange)

it('keeps an enrolled credential after every volatile host write is lost', async () => {
  const factory = new IDBFactory()
  const host = volatileHost()
  const local = new Map<string, unknown>()
  const storage = {
    loadLocalStorage: (key: string) => structuredClone(local.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { local.set(key, structuredClone(value)) },
  }
  let registryHost = await HostSyncStorage.open(factory, 'sample-vault', storage)
  const secrets = await DurableTokenSecrets.open(factory, 'sample-vault', host)
  const registry = TokenConnectionRegistry.open(storage)
  const id = registry.add()
  await registry.attachDurably(id, token, authority, secrets)
  const reference = registry.records()[0].secretReference
  registry.setStatus(id, 'syncing')
  registry.storage(id).saveLocalStorage('abele-sync-token-state:last-sync', 1)
  await registry.flush()
  host.crash()
  registryHost.close()
  local.clear()
  secrets.close()
  registryHost = await HostSyncStorage.open(factory, 'sample-vault', storage)
  expect(TokenConnectionRegistry.open(storage).records()[0].secretReference).toBe(reference)
  const restarted = await DurableTokenSecrets.open(factory, 'sample-vault', host)
  expect(restarted.get(reference)).toBe(token.key)
  restarted.close()
  registryHost.close()
})

it('does not publish a connection before its credential commit completes', async () => {
  const factory = new IDBFactory()
  const host = volatileHost()
  const local = new Map<string, unknown>()
  const storage = {
    loadLocalStorage: (key: string) => structuredClone(local.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { local.set(key, structuredClone(value)) },
  }
  let registryHost = await HostSyncStorage.open(factory, 'sample-vault', storage)
  let secrets = await DurableTokenSecrets.open(factory, 'sample-vault', host)
  let registry = TokenConnectionRegistry.open(storage)
  const id = registry.add()
  secrets.flush = async () => { throw new Error('injected commit failure') }
  await expect(registry.attachDurably(id, token, authority, secrets)).rejects.toThrow('injected commit failure')
  expect(registry.records()[0].secretReference).toBe('')
  secrets.close()
  registryHost.close()
  host.crash()
  local.clear()
  registryHost = await HostSyncStorage.open(factory, 'sample-vault', storage)
  secrets = await DurableTokenSecrets.open(factory, 'sample-vault', host)
  registry = TokenConnectionRegistry.open(storage)
  expect(registry.records()[0].pending).toBeDefined()
  expect(registry.records()[0].secretReference).toBe('')
  await registry.attachDurably(id, token, authority, secrets)
  expect(secrets.get(registry.records()[0].secretReference)).toBe(token.key)
  secrets.close()
  registryHost.close()
})

it('keeps the last completed rotation when volatile writes are lost', async () => {
  const factory = new IDBFactory()
  const host = volatileHost()
  let secrets = await DurableTokenSecrets.open(factory, 'sample-vault', host)
  const reference = 'abele-sync-device-token-sample'
  secrets.set(reference, token.key)
  await secrets.flush()
  secrets.set(reference, 'b'.repeat(43))
  host.crash()
  secrets.close()
  secrets = await DurableTokenSecrets.open(factory, 'sample-vault', host)
  expect(secrets.get(reference)).toBe(token.key)
  secrets.set(reference, 'c'.repeat(43))
  await secrets.flush()
  host.crash()
  secrets.close()
  secrets = await DurableTokenSecrets.open(factory, 'sample-vault', host)
  expect(secrets.get(reference)).toBe('c'.repeat(43))
  secrets.close()
})

it('resumes enrollment after credential COMMIT but before registry publication', async () => {
  const factory = new IDBFactory()
  const keychain = volatileHost()
  const local = new Map<string, unknown>()
  const storage = {
    loadLocalStorage: (key: string) => structuredClone(local.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { local.set(key, structuredClone(value)) },
  }
  let host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  let secrets = await DurableTokenSecrets.open(factory, 'sample-vault', keychain)
  let registry = TokenConnectionRegistry.open(storage)
  const id = registry.add()
  const commit = secrets.flush.bind(secrets)
  secrets.flush = async () => {
    await commit()
    throw new Error('injected crash after credential commit')
  }
  await expect(registry.attachDurably(id, token, authority, secrets)).rejects.toThrow('injected crash')
  secrets.close()
  host.close()
  keychain.crash()
  local.clear()
  host = await HostSyncStorage.open(factory, 'sample-vault', storage)
  secrets = await DurableTokenSecrets.open(factory, 'sample-vault', keychain)
  registry = TokenConnectionRegistry.open(storage)
  expect(registry.records()[0].pending).toBeDefined()
  await registry.attachDurably(id, token, authority, secrets)
  expect(secrets.get(registry.records()[0].secretReference)).toBe(token.key)
  host.close()
  secrets.close()
})

it('retries a rolled-back credential transaction without losing its write', async () => {
  const factory = new IDBFactory()
  const keychain = volatileHost()
  const reference = 'abele-sync-device-token-sample'
  const secrets = await DurableTokenSecrets.open(factory, 'sample-vault', keychain)
  secrets.set(reference, token.key)
  const put = IDBObjectStore.prototype.put
  let abortOnce = true
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (abortOnce && value?.reference === reference) {
      abortOnce = false
      this.transaction.abort()
    }
    return put.call(this, value, key)
  })
  try {
    await expect(secrets.flush()).rejects.toThrow()
  } finally {
    spy.mockRestore()
  }
  await secrets.flush()
  secrets.close()
  keychain.crash()
  const restarted = await DurableTokenSecrets.open(factory, 'sample-vault', keychain)
  expect(restarted.get(reference)).toBe(token.key)
  restarted.close()
})
