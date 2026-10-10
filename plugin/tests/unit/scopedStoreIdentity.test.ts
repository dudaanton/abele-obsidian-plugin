import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { openTokenLedger } from '@/sync/tokenLedger'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { openDeviceReviews } from '@/sync/openDeviceReviews'

async function setup() {
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
  const store = await openTokenLedger(factory, registry, record, () => {})
  return { data, registry, record, factory, store }
}

it('persists the device review identity checked after automatic reconnect', async () => {
  const review = await openDeviceReviews(new IDBFactory(), 'sample-local-vault')
  const store = (review.executables as any).documents.store as IndexedDbStateStore
  try {
    expect(await store.getMeta('device-review-identity-v1')).toBe('sample-local-vault')
    const db = (store as any).connection.db as IDBDatabase
    vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
      db.close()
      throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
    })
    expect(await review.executables.pending()).toEqual([])
    expect(store.permitsEngineEffects).toBe(true)
  } finally {
    review.close()
  }
})

it('persists the identity checked after a healthy WebKit-style engine reconnect', async () => {
  const { store } = await setup()
  try {
    const expected = await store.getMeta('token-engine-identity-v2')
    expect(expected).not.toBeNull()
    await store.setMeta('sample-reconnect-data', 'sample retained value')
    const db = (store as any).connection.db as IDBDatabase
    vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
      db.close()
      throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
    })
    expect(await store.getMeta('sample-reconnect-data')).toBe('sample retained value')
    expect(await store.getMeta('token-engine-identity-v2')).toBe(expected)
    expect(store.permitsEngineEffects).toBe(true)
  } finally {
    store.close()
  }
})

it.each(['header', 'database'] as const)(
  'holds recovery when the token %s is lost beside a durable CREATE journal',
  async (loss) => {
    const { store, factory, registry, record } = await setup()
    const journal = {
      batchId: 'sample-batch',
      idempotencyKey: 'sample-create-key',
      startedAt: new Date(0).toISOString(),
      ops: [
        {
          op: 'create' as const,
          path: 'Shared/sample.md',
          sha: 'a'.repeat(64),
          size: 10,
          mtime: 1000,
          kind: 'note' as const,
        },
      ],
    }
    await store.setJournal(journal)
    if (loss === 'header') await store.setMeta('token-engine-identity-v2', null)
    store.close()
    if (loss === 'database') await IndexedDbStateStore.delete(factory, record.ledgerId)
    await expect(openTokenLedger(factory, registry, record, () => {})).rejects.toThrow(
      /recovery|identity/i
    )
    const raw = await IndexedDbStateStore.open(factory, record.ledgerId)
    try {
      expect(await raw.getMeta('token-engine-identity-v2')).toBeNull()
      if (loss === 'header') expect(await raw.getJournal()).toEqual(journal)
      expect(
        registry.storage(record.id).loadLocalStorage('abele-sync-token-state:ledger-proof-v2')
      ).not.toBeNull()
    } finally {
      raw.close()
    }
  }
)

it('never overwrites a changed identity header on a cold reopen', async () => {
  const { store, factory, registry, record } = await setup()
  await store.setMeta('token-engine-identity-v2', 'invented-foreign-binding')
  store.close()
  await expect(openTokenLedger(factory, registry, record, () => {})).rejects.toThrow(
    /identity|binding/i
  )
  const raw = await IndexedDbStateStore.open(factory, record.ledgerId)
  try {
    expect(await raw.getMeta('token-engine-identity-v2')).toBe('invented-foreign-binding')
  } finally {
    raw.close()
  }
})
