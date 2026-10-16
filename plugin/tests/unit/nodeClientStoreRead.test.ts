/** The chat looks at the node store after every event without rewriting it. */
import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClientStore, readStore } from '@/node/NodeClientStore'

it('reads the state in a read-only transaction that writes nothing back', async () => {
  const factory = new IDBFactory()
  const store = new NodeClientStore('sample-read', factory)
  await store.transaction((s) => {
    s.cursors.sample = 3
  })
  const transaction = vi.spyOn(store, 'transaction')
  expect(await readStore(store, (s) => s.cursors.sample)).toBe(3)
  expect(transaction).not.toHaveBeenCalled()
  store.close()
})
