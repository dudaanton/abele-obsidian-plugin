import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'
import { promptAnswerStates } from '@/node/promptAnswers'
import { NodeManagerController } from '@/node/NodeManagerController'
import { NodeDelegationController } from '@/node/NodeDelegationController'
import type { NodeClient } from '@abele/node-client'

it('scans unchanged delivery and delegation receipts without constructing child drafts', async () => {
  const store = new NodeClientStore('sample-receipt-scan', new IDBFactory())
  try {
    await store.transaction((s) => {
      s.results.sample = { error: 'outcome_unknown' }
      s.managerOperations = {
        sample: { parent: 'sample-parent', method: 'command.v1.run', params: {} },
      }
    })
    const [receipt, operation] = await store.read((s) => [
      s.results.sample,
      s.managerOperations.sample,
    ])
    const get = vi.spyOn(Reflect, 'get')
    try {
      const client = { connected: false } as NodeClient
      await new NodeDelegationController(client, store).restore()
      await new NodeManagerController(client, store).wakeDelivered(() => false)
      expect(
        get.mock.calls.filter(([target]) => target === receipt || target === operation)
      ).toHaveLength(0)
    } finally {
      get.mockRestore()
    }
    expect(await store.read((s) => s.results.sample)).toBe(receipt)
  } finally {
    store.close()
  }
})

it('observes a legacy writer clearing its metadata-only receipt collection', async () => {
  const factory = new IDBFactory()
  const store = new NodeClientStore('sample-legacy-refresh', factory)
  await store.read(() => {})
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('abele-node-sample-legacy-refresh')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const write = (results: Record<string, { error: string }>) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction('client', 'readwrite')
      tx.objectStore('client').put({ cursors: {}, events: {}, outbox: [], results }, 'state')
      tx.objectStore('client').put(crypto.randomUUID(), 'state-revision')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
  try {
    await write({ sample: { error: 'outcome_unknown' } })
    expect(await store.read((state) => state.results.sample?.error)).toBe('outcome_unknown')
    await write({})
    expect(await store.read((state) => state.results.sample)).toBeUndefined()
  } finally {
    db.close()
    store.close()
  }
})

it('reads manager cards once for all parents during delivery polling', async () => {
  const store = new NodeClientStore('sample-delivery-refresh', new IDBFactory())
  try {
    await store.transaction((state) => {
      state.managerOperations = Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          'sample-' + i,
          { parent: 'sample-parent-' + (i % 2), method: 'command.v1.run', params: {} },
        ])
      )
    })
    const controller = new NodeManagerController({ connected: true } as NodeClient, store)
    const read = vi.spyOn(store, 'read')
    const clone = vi.spyOn(globalThis, 'structuredClone')
    try {
      await controller.wakeDelivered(() => false)
      expect(read.mock.calls.length).toBe(1)
      expect(
        clone.mock.calls.some(
          ([value]) =>
            Array.isArray(value) &&
            value.some(
              (row) =>
                Array.isArray(row) && row[1] && typeof row[1] === 'object' && 'params' in row[1]
            )
        )
      ).toBe(false)
    } finally {
      clone.mockRestore()
    }
  } finally {
    store.close()
  }
})

it('does not open write transactions to refresh unchanged manager history', async () => {
  const store = new NodeClientStore('sample-manager-refresh', new IDBFactory())
  try {
    await store.transaction((state) => {
      state.managerOperations = {}
      for (let i = 0; i < 1000; i++) {
        state.managerOperations['sample-' + i] = {
          parent: 'sample-parent-' + i,
          method: 'command.v1.run',
          params: {},
        }
        state.results['sample-' + i] = { error: 'outcome_unknown' }
      }
    })
    const controller = new NodeManagerController({ connected: true } as NodeClient, store)
    const write = vi.spyOn(store, 'transaction')
    await controller.restore()
    await controller.restore()
    expect(write.mock.calls.length).toBe(0)
  } finally {
    store.close()
  }
})

it('keeps large receipt collections stable and reads only a changed row across handles', async () => {
  const factory = new IDBFactory()
  const store = new NodeClientStore('sample-refresh', factory)
  const writer = new NodeClientStore('sample-refresh', factory)
  try {
    await store.transaction((state) => {
      for (let i = 0; i < 3000; i++) state.results['sample-' + i] = { error: 'outcome_unknown' }
    })
    const first = await store.read((state) => state.results)
    const get = vi.spyOn(IDBObjectStore.prototype, 'get')
    try {
      expect(await store.read((state) => state.results)).toBe(first)
      expect(get.mock.calls.filter(([key]) => String(key).startsWith('record:'))).toHaveLength(0)
      await writer.transaction((state) => {
        state.results['sample-42'] = { error: 'connection_lost' }
      })
      get.mockClear()
      const next = await store.read((state) => state.results)
      expect(next['sample-42'].error).toBe('connection_lost')
      expect(next['sample-41']).toBe(first['sample-41'])
      expect(get.mock.calls.filter(([key]) => String(key).startsWith('record:'))).toEqual([
        ['record:results:sample-42'],
      ])
      await expect(
        writer.transaction((state) => {
          state.results['sample-41'] = { error: 'sample-aborted' }
          throw new Error('sample-abort')
        })
      ).rejects.toThrow('sample-abort')
      expect(await store.read((state) => state.results)).toBe(next)
      await writer.transaction((state) => {
        delete state.results['sample-42']
      })
      expect(await store.read((state) => state.results['sample-42'])).toBeUndefined()
      expect(await store.read((state) => state.results['sample-41'])).toBe(first['sample-41'])
    } finally {
      get.mockRestore()
    }
  } finally {
    store.close()
    writer.close()
  }
})

it('parses each immutable prompt receipt once even when another receipt changes', () => {
  const inspect = vi.fn(() => ({ unrelated: true }))
  const results = Object.freeze(
    Object.fromEntries(
      Array.from({ length: 3000 }, (_, i) => [
        'sample-' + i,
        Object.freeze({
          get result() {
            return inspect()
          },
        }),
      ])
    )
  )
  const state = { results, outbox: [] }
  expect(promptAnswerStates(state, 'sample-session')).toEqual({})
  expect(inspect).toHaveBeenCalledTimes(3000)
  inspect.mockClear()
  expect(promptAnswerStates(state, 'another-session')).toEqual({})
  expect(inspect).not.toHaveBeenCalled()
  const changed = Object.freeze({
    ...results,
    'sample-new': Object.freeze({
      get result() {
        return inspect()
      },
    }),
  })
  promptAnswerStates({ ...state, results: changed }, 'sample-session')
  expect(inspect).toHaveBeenCalledTimes(1)
})

it('does not bounce metadata revisions between idle store handles', async () => {
  const factory = new IDBFactory()
  const first = new NodeClientStore('sample-idle-handles', factory)
  const second = new NodeClientStore('sample-idle-handles', factory)
  try {
    await first.transaction(() => {})
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    try {
      for (let i = 0; i < 4; i++) {
        await second.transaction(() => {})
        await first.transaction(() => {})
      }
      expect(
        put.mock.calls.filter(([, key]) => key === 'state' || key === 'state-revision')
      ).toEqual([])
    } finally {
      put.mockRestore()
    }
  } finally {
    first.close()
    second.close()
  }
})

it('rejects a keyed execution intent when its required strict flush cannot start', async () => {
  const store = new NodeClientStore('sample-execution-flush', new IDBFactory())
  await store.transaction(() => {})
  const db = await (store as unknown as { open(): Promise<IDBDatabase> }).open()
  const transaction = db.transaction.bind(db)
  const fail = vi.spyOn(db, 'transaction').mockImplementation((stores, mode, options) => {
    if (options?.durability === 'strict') throw new Error('sample flush unavailable')
    return transaction(stores, mode, options)
  })
  try {
    await expect(
      store.transaction((s) => {
        s.obsidianExecutions = { sample: { state: 'executing', result: {} } }
      })
    ).rejects.toThrow('sample flush unavailable')
  } finally {
    fail.mockRestore()
    store.close()
  }
})

it('validates keyed path intent request parameters before committing them', async () => {
  const store = new NodeClientStore('sample-invalid-intent', new IDBFactory())
  try {
    await expect(
      store.transaction((s) => {
        s.nodePathIntents = { sample: { id: 'sample', method: 'file.write', params: {} } }
      })
    ).rejects.toBeDefined()
    expect(await store.read((s) => s.nodePathIntents?.sample)).toBeUndefined()
  } finally {
    store.close()
  }
})

it('does not spin extra keepalive requests while polling an empty outbox', async () => {
  const store = new NodeClientStore('sample-idle-outbox', new IDBFactory())
  await store.transaction(() => {})
  const count = vi.spyOn(IDBObjectStore.prototype, 'count')
  try {
    expect(await store.transaction((s) => s.outbox[0])).toBeUndefined()
    expect(count.mock.calls.length).toBeLessThanOrEqual(1)
  } finally {
    count.mockRestore()
    store.close()
  }
})

it('retains unchanged collection identities when a different record map changes', async () => {
  const store = new NodeClientStore('sample-independent-maps', new IDBFactory())
  try {
    await store.transaction((s) => {
      s.results.sample = { error: 'outcome_unknown' }
      s.chatDrafts = { sample: { text: 'before', notice: '' } }
    })
    const before = await store.read((s) => s.results)
    await store.transaction((s) => {
      s.chatDrafts!.sample.text = 'after'
    })
    expect(await store.read((s) => s.results)).toBe(before)
    await store.transaction((s) => {
      s.cursors.sample = 1
    })
    expect(await store.read((s) => s.results)).toBe(before)
  } finally {
    store.close()
  }
})

it('does not rewrite a semantically identical keyed receipt', async () => {
  const store = new NodeClientStore('sample-identical-row', new IDBFactory())
  await store.transaction((s) => {
    s.results.sample = { result: { text: 'sample output '.repeat(10000) } }
  })
  const put = vi.spyOn(IDBObjectStore.prototype, 'put')
  try {
    await store.transaction((s) => {
      s.results.sample = { ...s.results.sample }
    })
    expect(put).not.toHaveBeenCalled()
  } finally {
    put.mockRestore()
    store.close()
  }
})

it('does not apply ordinary retention while only migrating existing history', async () => {
  const store = new NodeClientStore('sample-migration-retention', new IDBFactory())
  await store.read(() => {})
  const db = await (store as unknown as { open(): Promise<IDBDatabase> }).open()
  const tx = db.transaction('client', 'readwrite')
  tx.objectStore('client').put(
    {
      cursors: {},
      events: {},
      outbox: [],
      results: Object.fromEntries(
        Array.from({ length: 1001 }, (_, i) => [
          'sample-' + i,
          { result: 'sample retained result' },
        ])
      ),
    },
    'state'
  )
  tx.objectStore('client').put('sample-legacy', 'state-revision')
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  try {
    await store.transaction(() => {})
    expect(await store.read((s) => Object.keys(s.results).length)).toBe(1001)
  } finally {
    store.close()
  }
})

it('reuses answer receipts through unchanged transaction drafts and sees later draft edits', async () => {
  const { frozen, storeDraft } = await import('@/node/storeDraft')
  const { responseSchema } = await import('@abele/channel-protocol')
  const { PromptSchema } = await import('@abele/node-protocol')
  const base = frozen({
    results: { sample: { result: { session_id: 'sample-session' } } },
    outbox: [],
  })
  const parse = vi.spyOn(responseSchema(PromptSchema), 'safeParse')
  try {
    promptAnswerStates(storeDraft(base).value, 'sample-session')
    expect(parse).toHaveBeenCalledOnce()
    parse.mockClear()
    const draft = storeDraft(base).value
    promptAnswerStates(draft, 'sample-session')
    promptAnswerStates(draft, 'sample-session')
    expect(parse).not.toHaveBeenCalled()
    draft.results.sample.result = { session_id: 'changed-session' }
    promptAnswerStates(draft, 'sample-session')
    expect(parse).toHaveBeenCalledOnce()
  } finally {
    parse.mockRestore()
  }
})
