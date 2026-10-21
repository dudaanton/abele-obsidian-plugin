import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'

it('retains an executor receipt through closing and reopening its installation store', async () => {
  const factory = new IDBFactory()
  const store = new NodeClientStore('sample-tool-receipts', factory)
  const receipt = {
    state: 'succeeded' as const,
    result: { content: [{ type: 'text', text: 'Created: sample.md' }] },
  }
  await store.transaction((state) => {
    state.obsidianExecutions = { 'sample-invocation': receipt }
  })
  store.close()
  const reopened = new NodeClientStore('sample-tool-receipts', factory)
  try {
    expect(await reopened.read((state) => state.obsidianExecutions?.['sample-invocation'])).toEqual(
      receipt
    )
  } finally {
    reopened.close()
  }
})

it('rejects execution intent admission when the strict disk flush cannot be opened', async () => {
  const factory = new IDBFactory()
  const store = new NodeClientStore('sample-tool-flush-failure', factory)
  await store.transaction(() => {})
  const db = await (store as unknown as { open(): Promise<IDBDatabase> }).open()
  const transaction = db.transaction.bind(db)
  vi.spyOn(db, 'transaction').mockImplementation((names, mode, options) => {
    if (options?.durability === 'strict') throw new Error('disk flush unavailable')
    return transaction(names, mode, options)
  })
  try {
    await expect(
      store.transaction((state) => {
        state.obsidianExecutions = { 'sample-invocation': { state: 'executing', result: {} } }
      })
    ).rejects.toThrow('disk flush unavailable')
  } finally {
    store.close()
  }
})
