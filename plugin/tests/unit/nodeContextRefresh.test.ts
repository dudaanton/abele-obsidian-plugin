import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { responseSchema } from '@abele/channel-protocol'
import { PromptSchema } from '@abele/node-protocol'
import { NodeClientStore, type NodeClientState } from '@/node/NodeClientStore'
import { NodeManagerController } from '@/node/NodeManagerController'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { contextualNodeHistory } from '../fixtures/contextualNodeHistory.mjs'

it('retains contextual receipt revisions across manager and presenter refreshes', async () => {
  const factory = new IDBFactory()
  const opening = factory.open('abele-node-sample-context-integration', 3)
  opening.onupgradeneeded = () => {
    opening.result.createObjectStore('client')
    opening.result.createObjectStore('journal')
  }
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(opening.error)
  })
  const state = contextualNodeHistory(true) as unknown as NodeClientState
  const tx = database.transaction(['client', 'journal'], 'readwrite')
  const streams: Record<string, string> = {}
  for (const [stream, events] of Object.entries(state.events)) {
    streams[stream] = crypto.randomUUID()
    tx.objectStore('journal').put(events, stream)
  }
  tx.objectStore('client').put(streams, 'streams')
  tx.objectStore('client').put({ ...state, events: {} }, 'state')
  tx.objectStore('client').put('sample-legacy-revision', 'state-revision')
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  const store = new NodeClientStore('sample-context-integration', factory)
  const writer = new NodeClientStore('sample-context-integration', factory)
  const client = {
    connected: false,
    store,
    target: { expected_node_id: 'sample-node' },
    onEvent: () => () => {},
  }
  const manager = new NodeManagerController(client as never, store)
  const presenters = Array.from(
    { length: 4 },
    (_, i) =>
      new NodeChatPresenter(
        {
          kind: 'node-session',
          nodeId: 'sample-node',
          registrationId: 'sample-registration',
          sessionId: 'sample-session-' + i,
          title: 'Sample command conversation',
        },
        { client, state: ref('offline') } as never
      )
  )
  const refresh = async () => {
    await manager.cardsForParents(['sample-parent-0', 'sample-parent-1'])
    for (const presenter of presenters) await presenter.refresh()
  }
  try {
    await store.transaction(() => {})
    await writer.transaction(() => {})
    await refresh()
    const initial = await store.read((s) => s.results['sample-operation-1101'])
    const parse = vi.spyOn(responseSchema(PromptSchema), 'safeParse')
    const get = vi.spyOn(IDBObjectStore.prototype, 'get')
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    try {
      for (let i = 0; i < 3; i++) {
        await writer.transaction((s) => {
          s.outbox = s.outbox.filter(() => true)
        })
        await refresh()
      }
      expect(parse.mock.calls.length).toBe(0)
      expect(put.mock.calls.length).toBe(0)
      expect(
        get.mock.calls.filter(([key]) => key === 'state' || String(key).startsWith('record:'))
      ).toEqual([])
      await writer.transaction((s) => {
        const receipt = s.results['sample-operation-1100'].result as { stdout: string }
        receipt.stdout += '\nChanged sample output'
      })
      get.mockClear()
      parse.mockClear()
      await refresh()
      expect(parse.mock.calls.length).toBe(1)
      expect(get.mock.calls.filter(([key]) => String(key).startsWith('record:'))).toEqual([
        ['record:results:sample-operation-1100'],
      ])
      expect(await store.read((s) => s.results['sample-operation-1101'])).toBe(initial)
    } finally {
      parse.mockRestore()
      get.mockRestore()
      put.mockRestore()
    }
  } finally {
    for (const presenter of presenters) presenter.destroy()
    store.close()
    writer.close()
    database.close()
  }
}, 60000)
