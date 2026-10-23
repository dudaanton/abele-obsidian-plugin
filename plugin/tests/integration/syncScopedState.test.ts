import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { StateStore } from '@abele/sync-sdk/core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

it('keeps retry schedules and exact retained answers atomic across interruption and restart', async () => {
  const factory = new IDBFactory()
  const name = 'sample-retry-restart'
  let store = await IndexedDbStateStore.open(factory, name)
  const schedule = 'file-retry:Shared%2Fsample.md'
  const receipt = 'push-receipt:sample-operation'
  const answer = JSON.stringify({
    path: 'Shared/sample.md',
    op: { op: 'delete', file_id: 'sample-file', base_version_id: 'sample-version' },
    result: { status: 'applied', file_id: 'sample-file', version_id: 'sample-deleted' },
    base: {
      path: 'Shared/sample.md',
      wirePath: 'Shared/sample.md',
      fileId: 'sample-file',
      versionId: 'sample-version',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1000,
    },
  })
  try {
    await store.transaction(async (tx) => {
      await tx.setMeta!(schedule, 'malformed raw schedule retained verbatim')
      await tx.setMeta!(receipt, answer)
      expect(await tx.metadataKeys!('file-retry:')).toEqual([schedule])
      expect(await tx.getMeta!(receipt)).toBe(answer)
    })
    await expect(
      store.transaction(async (tx) => {
        await tx.setMeta!(schedule, null)
        await tx.setMeta!(receipt, null)
        throw new Error('interrupted settlement')
      })
    ).rejects.toThrow('interrupted settlement')
    store.close()
    store = await IndexedDbStateStore.open(factory, name)
    expect(await store.getMeta(schedule)).toBe('malformed raw schedule retained verbatim')
    expect(await store.getMeta(receipt)).toBe(answer)
    expect(await store.metadataKeys('push-receipt:')).toEqual([receipt])
    await store.transaction(async (tx) => {
      await tx.setMeta!(schedule, null)
      await tx.setMeta!(receipt, null)
    })
    expect(await store.metadataKeys('file-retry:')).toEqual([])
    expect(await store.metadataKeys('push-receipt:')).toEqual([])
  } finally {
    store.close()
  }
})

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
