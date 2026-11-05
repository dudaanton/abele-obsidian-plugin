import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'
import { largeMutationHistory } from '../fixtures/largeMutationHistory.mjs'

const get = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

it('migrates 300 large mutation images atomically and leaves idle metadata small', async () => {
  const factory = new IDBFactory()
  const request = factory.open('abele-node-sample-large-mutations', 3)
  request.onupgradeneeded = () => {
    request.result.createObjectStore('client')
    request.result.createObjectStore('journal')
  }
  const db = await get(request)
  const original = largeMutationHistory()
  const seed = db.transaction('client', 'readwrite')
  seed
    .objectStore('client')
    .put({ cursors: {}, events: {}, outbox: [], results: {}, chatMutations: original }, 'state')
  seed.objectStore('client').put('sample-legacy-revision', 'state-revision')
  await new Promise<void>((resolve, reject) => {
    seed.oncomplete = () => resolve()
    seed.onabort = () => reject(seed.error)
  })
  const first = new NodeClientStore('sample-large-mutations', factory)
  const second = new NodeClientStore('sample-large-mutations', factory)
  try {
    const originalPut = IDBObjectStore.prototype.put
    let copied = 0
    const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
      if (String(args[1]).startsWith('record:chatMutations:') && ++copied === 5)
        throw new Error('sample interrupted migration')
      return originalPut.apply(this, args)
    })
    try {
      await expect(first.transaction(() => {})).rejects.toThrow('sample interrupted migration')
    } finally {
      fail.mockRestore()
    }
    const retained = await get(db.transaction('client').objectStore('client').get('state'))
    expect(Object.keys(retained.chatMutations)).toHaveLength(300)
    await first.transaction(() => {})
    const raw = await get(db.transaction('client').objectStore('client').get('state'))
    expect(raw.chatMutations).toBeUndefined()
    expect(JSON.stringify(raw).length).toBeLessThan(2000)
    const packed = await get(
      db.transaction('client').objectStore('client').get('record:chatMutations:sample-mutation-0')
    )
    expect(JSON.stringify(packed).length).toBeLessThan(
      JSON.stringify(original['sample-mutation-0']).length * 0.6
    )
    expect(await second.read((s) => s.chatMutations)).toEqual(original)
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    const read = vi.spyOn(IDBObjectStore.prototype, 'get')
    try {
      for (let i = 0; i < 4; i++) {
        await second.transaction((s) => {
          s.outbox = s.outbox.filter(() => true)
        })
        await first.transaction(() => {})
      }
      expect(put).not.toHaveBeenCalled()
      expect(
        read.mock.calls.some(
          ([key]) => key === 'state' || String(key).startsWith('record:chatMutations:')
        )
      ).toBe(false)
      await second.transaction((s) => {
        s.chatMutations!['sample-mutation-0'].state = 'applied'
      })
      read.mockClear()
      expect(await first.read((s) => s.chatMutations!['sample-mutation-0'])).toEqual({
        ...original['sample-mutation-0'],
        state: 'applied',
      })
      expect(
        read.mock.calls.filter(([key]) => String(key).startsWith('record:chatMutations:'))
      ).toEqual([['record:chatMutations:sample-mutation-0']])
    } finally {
      put.mockRestore()
      read.mockRestore()
    }
  } finally {
    first.close()
    second.close()
    db.close()
  }
}, 60000)
