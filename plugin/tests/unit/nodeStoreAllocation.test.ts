import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { NodeClientStore, type NodeClientState } from '@/node/NodeClientStore'
import { plain } from '@/node/storeDraft'
import { idleStoreJournal } from '../fixtures/idleStoreJournal.mjs'

it.each(['transaction', 'read'] as const)(
  'enumerates and clones retained legacy artifacts with %s as the first access',
  async (firstAccess) => {
    const factory = new IDBFactory()
    const namespace = 'sample-legacy-artifacts-' + firstAccess
    const artifacts = Object.fromEntries(
      Array.from({ length: 160 }, (_, i) => [
        'sample-' + i,
        { text: ('sample artifact ' + i + ' ').repeat(8000) },
      ])
    )
    await new Promise<void>((resolve, reject) => {
      const opening = factory.open('abele-node-' + namespace, 2)
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore('client')
        opening.result.createObjectStore('journal')
      }
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const db = opening.result
        const tx = db.transaction('client', 'readwrite')
        tx.objectStore('client').put(
          { cursors: {}, events: {}, outbox: [], results: {}, artifactData: artifacts },
          'state'
        )
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onabort = () => {
          db.close()
          reject(tx.error)
        }
      }
    })
    const store = new NodeClientStore(namespace, factory)
    const inspect = (state: NodeClientState) => {
      expect(Object.keys(state)).toContain('artifactData')
      expect(Object.keys(state.artifactData!)).toEqual(Object.keys(artifacts))
      expect({ ...state.artifactData }).toEqual(artifacts)
      expect(JSON.stringify(state.artifactData)).toBe(JSON.stringify(artifacts))
      // Native structuredClone cannot accept proxies; normalize transaction drafts first.
      expect(structuredClone(plain(state.artifactData))).toEqual(artifacts)
      return state.artifactData
    }
    try {
      expect(await store[firstAccess](inspect)).toEqual(artifacts)
      expect(await store.transaction(inspect)).toEqual(artifacts)
      await store.read((state) => {
        inspect(state)
        expect(Object.isFrozen(state.artifactData)).toBe(true)
        expect(structuredClone(state.artifactData)).toEqual(artifacts)
      })
      await store.transaction((state) => {
        state.artifactData!['sample-0'].text = 'updated'
      })
      expect(await store.read((state) => state.artifactData!['sample-0'].text)).toBe('updated')
    } finally {
      store.close()
    }
  }
)

it('reuses frozen metadata and records without reading or serializing unchanged payloads', async () => {
  const store = new NodeClientStore('sample-allocation', new IDBFactory())
  try {
    await store.transaction((s) => {
      s.chatDrafts = { sample: { text: 'sample '.repeat(1000), notice: '' } }
      s.results.sample = { result: { payload: 'sample '.repeat(1000) } }
    })
    const first = await store.read((s) => [s.chatDrafts, s.results.sample])
    const get = vi.spyOn(IDBObjectStore.prototype, 'get')
    const stringify = vi.spyOn(JSON, 'stringify')
    const clone = vi.spyOn(globalThis, 'structuredClone')
    try {
      for (let i = 0; i < 5; i++) {
        const next = await store.read((s) => [s.chatDrafts, s.results.sample])
        expect(next[0]).toBe(first[0])
        expect(next[1]).toBe(first[1])
        await store.transaction((s) => {
          void s.chatDrafts
          void s.results.sample
        })
      }
      expect(get.mock.calls.filter(([key]) => key === 'state')).toHaveLength(0)
      expect(stringify).not.toHaveBeenCalled()
      expect(
        clone.mock.calls.some(([value]) => value && typeof value === 'object' && 'sample' in value)
      ).toBe(false)
      expect(Object.isFrozen(first[0])).toBe(true)
      expect(Object.isFrozen(first[1])).toBe(true)
    } finally {
      get.mockRestore()
      stringify.mockRestore()
      clone.mockRestore()
    }
    await expect(
      store.read((s) => {
        s.results = {}
      })
    ).rejects.toThrow(TypeError)
    await expect(
      store.read((s) => {
        s.artifactData = {}
      })
    ).rejects.toThrow(TypeError)
    await expect(
      store.transaction((s) => {
        ;(s.cursors as Record<string, unknown>).sample = 'bad'
      })
    ).rejects.toThrow()
    expect(await store.read((s) => s.cursors.sample)).toBeUndefined()
  } finally {
    store.close()
  }
})

it('applies a smaller history window without requiring a journal mutation', async () => {
  const store = new NodeClientStore('sample-reduced-window', new IDBFactory())
  try {
    await store.transaction((s) => {
      s.windows = { 'sample-session': 800 }
      s.events['sample-session'] = idleStoreJournal(800)
    })
    await store.transaction((s) => {
      s.windows!['sample-session'] = 100
    })
    expect(await store.read((s) => s.events['sample-session'].length)).toBe(100)
    await store.transaction((s) => {
      void s.events['sample-session']
    })
    expect(await store.read((s) => s.events['sample-session'][0].seq)).toBe(701)
  } finally {
    store.close()
  }
})
