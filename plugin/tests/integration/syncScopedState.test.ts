import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { StateStore } from '@abele/sync-sdk/core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

it('isolates same-key root writes and revokes completed handles', async () => {
  const store = await IndexedDbStateStore.open(new IDBFactory(), 'sample-scoped')
  let handle!: StateStore
  try {
    await expect(
      store.transaction(async (tx) => {
        handle = tx
        await tx.setMeta!('sample', 'private')
        await store.setMeta('sample', 'independent')
        expect(await tx.getMeta!('sample')).toBe('private')
        throw new Error('interrupted')
      })
    ).rejects.toThrow('interrupted')
    expect(await store.getMeta('sample')).toBe('independent')
    await expect(handle.setCursor(7)).rejects.toThrow()
  } finally {
    store.close()
  }
})

it('rejects stale cross-connection publication without losing committed writes', async () => {
  const factory = new IDBFactory()
  const store = await IndexedDbStateStore.open(factory, 'sample-revision')
  const other = await IndexedDbStateStore.open(factory, 'sample-revision')
  try {
    await expect(
      store.transaction(async (tx) => {
        await tx.setCursor(9)
        await other.setCursor(4)
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await store.getCursor()).toBe(4)
  } finally {
    store.close()
    other.close()
  }
})

import { rollbackIsolation } from '../helpers/syncStateTransactionContract'

it('satisfies the SDK rollback isolation contract', async () => {
  const store = await IndexedDbStateStore.open(new IDBFactory(), 'sample-contract')
  try {
    await rollbackIsolation(store)
  } finally {
    store.close()
  }
})
