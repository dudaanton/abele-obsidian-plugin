// @vitest-environment node
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import { HostSyncStorage } from '@/sync/hostSyncStorage'

it('bounds each host task of inspection-cache writes and preserves ordered replacement', async () => {
  const factory = new IDBFactory()
  const host = await HostSyncStorage.open(factory, 'sample-inspection-writes', {
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  })
  const writes = new Map<IDBTransaction, number>()
  const original = IDBObjectStore.prototype.put
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    writes.set(this.transaction, (writes.get(this.transaction) ?? 0) + 1)
    return original.apply(this, args)
  })
  try {
    const entries = Array.from({ length: 769 }, (_, i) => ({
      path: `sample-${i}.md`,
      marker: 'old',
    }))
    const first = host.writeInspections(entries)
    const second = host.writeInspections([{ path: 'sample-768.md', marker: 'new' }])
    await Promise.all([first, second])
    const stored = (await host.readInspections()) as typeof entries
    expect(stored).toHaveLength(entries.length)
    expect(stored.find((row) => row.path === 'sample-768.md')?.marker).toBe('new')
    expect(Math.max(...writes.values())).toBeLessThanOrEqual(256)
    expect(writes.size).toBeGreaterThan(1)
  } finally {
    put.mockRestore()
    host.close()
  }
})
