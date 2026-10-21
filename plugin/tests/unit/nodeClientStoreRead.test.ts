/** The chat looks at the node store after every event without rewriting it. */
import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClientStore, readStore } from '@/node/NodeClientStore'
import { activeNodeLetters } from '@/node/nodeChatLetters'

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

it('removes only abandoned letter submissions before reconnect and retains provenance', async () => {
  const store = new NodeClientStore('sample-letter-recovery', new IDBFactory())
  activeNodeLetters.add('sample-letter')
  try {
    await store.transaction((raw) => {
      const state = raw as import('@/node/NodeClientStore').NodeClientState
      state.nodeLetters = {
        'sample-letter': {
          sessionId: 'sample',
          from: { id: 'sender', title: 'Sample sender' },
          status: 'pending',
        },
      }
      state.outbox.push(
        {
          operation_id: 'sample-letter',
          method: 'session.send',
          params: { session_id: 'sample', text: 'Sample question', observed_seq: 0 },
        },
        { operation_id: 'sample-other', method: 'session.stop', params: { session_id: 'sample' } }
      )
    })
    expect(await store.read((state) => state.outbox.length)).toBe(2)
    activeNodeLetters.delete('sample-letter')
    await store.transaction(() => {})
    expect(await store.read((state) => state.outbox.map((entry) => entry.operation_id))).toEqual([
      'sample-other',
    ])
    expect(await store.read((state) => state.nodeLetters?.['sample-letter'])).toMatchObject({
      status: 'interrupted',
      from: { id: 'sender' },
    })
  } finally {
    activeNodeLetters.delete('sample-letter')
    store.close()
  }
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
