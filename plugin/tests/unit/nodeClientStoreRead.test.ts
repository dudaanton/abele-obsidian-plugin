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

it('commits what only adds events relaxed, and flushes a change of anything else to disk before it completes', async () => {
  const factory = new IDBFactory()
  const store = new NodeClientStore('sample-durability', factory)
  await store.transaction(() => {})
  const db = await (store as unknown as { open(): Promise<IDBDatabase> }).open()
  const opened = vi.spyOn(db, 'transaction')
  const durability = () =>
    opened.mock.calls
      .filter(([, mode]) => mode === 'readwrite')
      .map(([, , options]) => (options as IDBTransactionOptions | undefined)?.durability)
  await store.transaction((s) => {
    s.cursors.sample = 1
    s.events.sample = []
  })
  expect(durability()).toEqual(['relaxed'])
  opened.mockClear()
  await store.transaction((s) => {
    s.outbox.push({
      operation_id: 'sample-op',
      method: 'session.stop',
      params: { session_id: 'x' },
    })
  })
  expect(durability()).toEqual(['relaxed', 'strict'])
  store.close()
})
