import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'
import { idleStoreJournal } from '../fixtures/idleStoreJournal.mjs'

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
