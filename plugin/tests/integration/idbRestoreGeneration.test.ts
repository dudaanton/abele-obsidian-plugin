import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { GENERATION_KEY, reconcileGeneration } from '@abele/sync-sdk/core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

const row = {
  path: 'sample.md',
  wirePath: 'sample.md',
  fileId: 'sample-file',
  versionId: 'sample-version',
  sha: 'a'.repeat(64),
  size: 1,
  mtime: 1,
}

it('lists plugin metadata keys by prefix, including uncommitted transaction writes', async () => {
  const store = await IndexedDbStateStore.open(new IDBFactory(), 'sample-meta-keys')
  try {
    await store.setMeta('pull-write:committed', '{}')
    await store.setMeta('pull-write:removed', '{}')
    await store.setMeta('other', 'value')
    await store.transaction(async () => {
      await store.setMeta('pull-write:pending', '{}')
      await store.setMeta('pull-write:removed', null)
      expect((await store.metadataKeys('pull-write:')).sort()).toEqual([
        'pull-write:committed',
        'pull-write:pending',
      ])
    })
    expect((await store.metadataKeys('pull-write:')).sort()).toEqual([
      'pull-write:committed',
      'pull-write:pending',
    ])
  } finally {
    store.close()
  }
})

it('retires download intents without a ledger row when the server generation changes', async () => {
  const store = await IndexedDbStateStore.open(new IDBFactory(), 'sample-restore-intents')
  try {
    await store.setMeta(GENERATION_KEY, 'old')
    await store.put(row)
    await store.setMeta('pull-write:sample-file', '{"stage":"tracked"}')
    await store.setMeta('pull-write:unlisted-file', '{"stage":"orphan"}')
    expect(await reconcileGeneration(store, 'new')).toBe(true)
    expect(await store.getMeta('pull-write:sample-file')).toBeNull()
    expect(await store.getMeta('pull-write:unlisted-file')).toBeNull()
  } finally {
    store.close()
  }
})
