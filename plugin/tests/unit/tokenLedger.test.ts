import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { openTokenLedger } from '@/sync/tokenLedger'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
it('reopens its bound ledger and refuses an evicted ledger instead of bootstrapping again', async () => {
  const data = new Map<string, unknown>(),
    registry = TokenConnectionRegistry.open({
      loadLocalStorage: (key) => data.get(key),
      saveLocalStorage: (key, value) => {
        data.set(key, value)
      },
    })
  const id = registry.add(),
    scope = { kind: 'folder' as const, id: 'sample-root', path: '/' }
  const keys = new Map<string, string>()
  registry.attach(
    id,
    { v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope },
    { protocol: 2, token_id: 'sample-token', space_id: 'sample-space', scope, status: 'active' },
    {
      get: (ref) => keys.get(ref) ?? null,
      set: (ref, key) => {
        keys.set(ref, key)
      },
    }
  )
  const record = registry.records()[0],
    factory = new IDBFactory()
  const first = await openTokenLedger(factory, registry, record, () => {})
  await first.setCursor(17)
  first.close()
  const second = await openTokenLedger(factory, registry, record, () => {})
  expect(await second.getCursor()).toBe(17)
  second.close()
  await IndexedDbStateStore.delete(factory, record.ledgerId)
  await expect(openTokenLedger(factory, registry, record, () => {})).rejects.toThrow(/recovery/i)
})
