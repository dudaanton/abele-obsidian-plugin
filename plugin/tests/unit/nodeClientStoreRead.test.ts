/** The chat looks at the node store after every event without rewriting it. */
import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore, IDBRequest } from 'fake-indexeddb'
import { NodeClientStore, readStore } from '@/node/NodeClientStore'
import { activeNodeLetters } from '@/node/nodeChatLetters'
import { giantJournal } from '../fixtures/giantJournal.mjs'

it('leaves the legacy database intact when migration validation fails', async () => {
  const factory = new IDBFactory()
  const legacy = {
    cursors: {},
    events: {},
    outbox: [],
    results: {},
    unsupported: 'sample recovery evidence',
  }
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('abele-node-sample-invalid-migration', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('client').put(legacy, 'state')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      open.result.close()
      resolve()
    }
  })
  const store = new NodeClientStore('sample-invalid-migration', factory)
  await expect(store.read(() => null)).rejects.toBeDefined()
  const retained = await new Promise<unknown>((resolve, reject) => {
    const open = factory.open('abele-node-sample-invalid-migration', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction('client')
      const get = tx.objectStore('client').get('state')
      get.onsuccess = () => resolve(get.result)
      tx.oncomplete = () => open.result.close()
    }
  })
  expect(retained).toEqual(legacy)
})

it('writes after an awaited callback inside an active IndexedDB request handler', async () => {
  const store = new NodeClientStore('sample-active-request', new IDBFactory())
  let active = false
  const writes: boolean[] = []
  const dispatch = IDBRequest.prototype.dispatchEvent
  const put = IDBObjectStore.prototype.put
  const dispatchSpy = vi
    .spyOn(IDBRequest.prototype, 'dispatchEvent')
    .mockImplementation(function (event) {
      active = true
      try {
        return dispatch.call(this, event)
      } finally {
        active = false
      }
    })
  const putSpy = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function (value, key) {
      if (key === 'state') writes.push(active)
      return put.call(this, value, key)
    })
  try {
    await store.transaction(async (state) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      state.cursors.sample = 1
    })
    expect(writes).toEqual([true])
  } finally {
    dispatchSpy.mockRestore()
    putSpy.mockRestore()
    store.close()
  }
})

it('migrates legacy sessions atomically to bounded journals while retaining recovery state', async () => {
  const factory = new IDBFactory()
  const journal = giantJournal({ turns: 60, outputBytes: 40 })
  const legacy = {
    cursors: { sample: journal.length },
    events: { sample: journal },
    outbox: [],
    results: {},
    chatDrafts: { sample: { text: 'Unsent sample', notice: '' } },
  }
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('abele-node-sample-migration', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('client').put(legacy, 'state')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      open.result.close()
      resolve()
    }
  })
  const store = new NodeClientStore('sample-migration', factory)
  try {
    expect(await store.read((state) => state.events.sample)).toEqual(journal.slice(-400))
    expect(await store.read((state) => state.cursors.sample)).toBe(journal.length)
    expect(await store.read((state) => state.chatDrafts)).toEqual(legacy.chatDrafts)
    await store.transaction((state) => {
      state.cursors.other = 1
    })
  } finally {
    store.close()
  }
  const reopened = new NodeClientStore('sample-migration', factory)
  try {
    expect(await reopened.read((state) => state.events.sample)).toEqual(journal.slice(-400))
  } finally {
    reopened.close()
  }
})

it('isolates cached journals across handles, failed callbacks, and readonly mutations', async () => {
  const factory = new IDBFactory()
  const first = new NodeClientStore('sample-cache-isolation', factory)
  const second = new NodeClientStore('sample-cache-isolation', factory)
  const journal = giantJournal({ turns: 1 })
  try {
    await first.transaction((state) => {
      state.events.sample = journal
    })
    expect(await second.read((state) => state.events.sample.length)).toBe(journal.length)
    await expect(
      first.transaction((state) => {
        state.events.sample[0].data = { damaged: true }
        throw new Error('Sample rollback')
      })
    ).rejects.toThrow('Sample rollback')
    await first.read((state) => {
      state.events.sample.length = 0
    })
    expect(await first.read((state) => state.events.sample)).toEqual(journal)
    await second.transaction((state) => {
      state.events.sample = journal.slice(1)
    })
    expect(await first.read((state) => state.events.sample)).toEqual(journal.slice(1))
    await first.transaction((state) => {
      state.events = {}
    })
    expect(await second.read((state) => state.events)).toEqual({})
  } finally {
    first.close()
    second.close()
  }
})

it('bounds newly received sessions without trimming control streams or cursor evidence', async () => {
  const store = new NodeClientStore('sample-session-retention', new IDBFactory())
  const journal = giantJournal({ turns: 60, outputBytes: 40 })
  const control = journal.map((event) => ({ ...event, type: 'sample.control' }))
  try {
    await store.transaction((state) => {
      state.events.sample = journal
      state.events.mailbox = control
      state.cursors.sample = journal.length
    })
    expect(await store.read((state) => state.events.sample)).toEqual(journal.slice(-400))
    expect(await store.read((state) => state.events.mailbox)).toEqual(control)
    expect(await store.read((state) => state.cursors.sample)).toBe(journal.length)
  } finally {
    store.close()
  }
})

it('keeps journals out of metadata and does not read or rewrite them on idle ticks', async () => {
  const store = new NodeClientStore('sample-split-journal', new IDBFactory())
  const journal = giantJournal({ turns: 3 })
  await store.transaction((state) => {
    state.events.sample = journal
  })
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  const put = vi.spyOn(IDBObjectStore.prototype, 'put')
  try {
    await store.transaction((state) => {
      state.cursors.sample = journal.length
    })
    expect(
      (put.mock.calls.find(([, key]) => key === 'state')?.[0] as { events: unknown }).events
    ).toEqual({})
    expect(put.mock.calls.filter(([, key]) => key === 'sample')).toHaveLength(0)
    expect(get.mock.calls.filter(([key]) => key === 'sample')).toHaveLength(0)
    expect(await store.read((state) => state.events.sample)).toEqual(journal)
  } finally {
    get.mockRestore()
    put.mockRestore()
    store.close()
  }
})

it('reads the state only once while an asynchronous transaction is waiting', async () => {
  const store = new NodeClientStore('sample-idle-read-count', new IDBFactory())
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  try {
    await store.transaction(async (state) => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      state.cursors.sample = 1
    })
    expect(get.mock.calls.filter(([key]) => key === 'state')).toHaveLength(1)
    expect(await store.read((state) => state.cursors.sample)).toBe(1)
  } finally {
    get.mockRestore()
    store.close()
  }
})

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
