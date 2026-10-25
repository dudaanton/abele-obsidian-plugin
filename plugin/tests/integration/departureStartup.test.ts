// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange, IDBDatabase } from 'fake-indexeddb'
import { loadDepartureMarks } from '../../node_modules/@abele/sync-sdk/dist/internal/core/departureMarks.js'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

it('restores 33k departure overrides without a serial transaction for each mark', async () => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  const factory = new IDBFactory()
  const state = await IndexedDbStateStore.open(factory, 'sample-departure-startup')
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open('sample-departure-startup', 3)
    request.onsuccess = () => resolve(request.result)
  })
  const prefix = 'v2-departure-path:'
  const paths = Array.from({ length: 33000 }, (_, i) => `Shared/Sample ${i}.md`)
  const tx = db.transaction('meta', 'readwrite')
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  tx.objectStore('meta').put({
    key: 'plugin:' + prefix + 'index',
    value: JSON.stringify({ first: paths[0], last: paths.at(-1) }),
  })
  paths.forEach((path, i) =>
    tx.objectStore('meta').put({
      key: 'plugin:' + prefix + 'p:' + encodeURIComponent(path),
      value: JSON.stringify({ present: i % 3 === 0, next: paths[i + 1] ?? null }),
    })
  )
  await done
  db.close()
  const original = IDBDatabase.prototype.transaction
  let transactions = 0
  const observed = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    ...args
  ) {
    if (++transactions > 1024) throw new Error('serial startup transaction budget exceeded')
    return original.apply(this, args)
  })
  try {
    const departed = new Set(paths)
    const started = performance.now()
    await loadDepartureMarks(state, prefix, departed)
    const elapsed = performance.now() - started
    console.log('departure startup', { elapsed, transactions })
    expect(elapsed).toBeLessThan(5000)
    expect(transactions).toBeLessThan(10)
    expect([...departed]).toEqual(paths.filter((_, i) => i % 3 === 0))
  } finally {
    observed.mockRestore()
    state.close()
    vi.unstubAllGlobals()
  }
}, 60000)

it.each(['missing', 'cycle', 'invalid'] as const)(
  'retains the linked-index rejection for a %s mark with a prefix snapshot',
  async (mode) => {
    vi.stubGlobal('IDBKeyRange', IDBKeyRange)
    const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-invalid-' + mode)
    const prefix = 'v2-departure-path:'
    try {
      await state.setMeta(
        prefix + 'index',
        JSON.stringify({ first: 'sample.md', last: 'sample.md' })
      )
      if (mode !== 'missing')
        await state.setMeta(
          prefix + 'p:sample.md',
          JSON.stringify({
            present: mode === 'invalid' ? 'invalid' : false,
            next: mode === 'cycle' ? 'sample.md' : null,
          })
        )
      await expect(loadDepartureMarks(state, prefix, new Set())).rejects.toThrow(
        mode === 'missing' ? 'missing departure' : 'invalid departure'
      )
    } finally {
      state.close()
      vi.unstubAllGlobals()
    }
  }
)

it('takes a fresh prefix snapshot on each load and retains the legacy state port', async () => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-fresh-departures')
  const legacy = new MemoryStateStore()
  const prefix = 'v2-departure-path:'
  try {
    for (const port of [state, legacy]) {
      await port.setMeta(
        prefix + 'index',
        JSON.stringify({ first: 'sample.md', last: 'sample.md' })
      )
      await port.setMeta(prefix + 'p:sample.md', JSON.stringify({ present: true, next: null }))
      const paths = new Set<string>()
      await loadDepartureMarks(port, prefix, paths)
      expect([...paths]).toEqual(['sample.md'])
      await port.setMeta(prefix + 'p:sample.md', JSON.stringify({ present: false, next: null }))
      await loadDepartureMarks(port, prefix, paths)
      expect([...paths]).toEqual([])
    }
  } finally {
    state.close()
    vi.unstubAllGlobals()
  }
})
