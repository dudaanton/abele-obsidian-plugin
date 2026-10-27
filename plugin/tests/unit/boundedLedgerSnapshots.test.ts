// @vitest-environment node
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { inspectExistingLedger } from '@/sync/external/pluginSafety'

it('bounds native result deserialization for entry, classification and lifecycle snapshots', async () => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  const factory = new IDBFactory()
  const state = await IndexedDbStateStore.open(factory, 'sample-bounded-snapshots')
  const host = await HostSyncStorage.open(factory, 'sample-bounded-snapshots', {
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  })
  const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  try {
    for (let i = 0; i < 65; i++) {
      await state.put({
        path: `sample-${i}.md`,
        fileId: `file-${i}`,
        versionId: 'v1',
        sha: 'a'.repeat(64),
        size: 1,
        mtime: 1,
      })
      await state.setMeta(`sample:${i}`, `value-${i}`)
    }
    await host.writeInspections(
      Array.from({ length: 65 }, (_, i) => ({
        path: i === 64 ? '\uffff/sample.md' : `sample-${i}.md`,
      }))
    )
    getAll.mockClear()
    const entries = []
    for await (const entry of state.all()) entries.push(entry)
    expect(entries).toHaveLength(65)
    expect(await host.readInspections()).toHaveLength(65)
    const db = Reflect.get(Reflect.get(state, 'connection'), 'db') as IDBDatabase
    expect((await inspectExistingLedger(factory, db.name))?.metadata.get('plugin:sample:64')).toBe(
      'value-64'
    )
    expect((await state.pluginMeta()).size).toBe(65)
    expect(getAll.mock.calls.length).toBeGreaterThan(3)
    expect(getAll.mock.calls.every(([, count]) => typeof count === 'number' && count <= 32)).toBe(
      true
    )
  } finally {
    getAll.mockRestore()
    host.close()
    state.close()
    vi.unstubAllGlobals()
  }
})

it.each([true, false])(
  'keeps one snapshot while a writer queues between pages (ranges=%s)',
  async (ranges) => {
    if (ranges) vi.stubGlobal('IDBKeyRange', IDBKeyRange)
    else vi.stubGlobal('IDBKeyRange', undefined)
    const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-snapshot-writer')
    const entry = (i: number) => ({
      path: `sample-${String(i).padStart(3, '0')}.md`,
      fileId: `file-${i}`,
      versionId: 'v1',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    })
    let writer: Promise<void> | undefined
    const queueWriter = (store: IDBObjectStore, request: IDBRequest) => {
      if (store.name === 'entries')
        request.addEventListener(
          'success',
          () => {
            writer ??= state.put({ ...entry(63), versionId: 'v2' })
          },
          { once: true }
        )
    }
    const original = IDBObjectStore.prototype.getAll
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = original.apply(this, args)
      queueWriter(this, request)
      return request
    })
    const originalCursor = IDBObjectStore.prototype.openCursor
    const cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = originalCursor.apply(this, args)
      queueWriter(this, request)
      return request
    })
    try {
      for (let i = 0; i < 64; i++) await state.put(entry(i))
      const rows = []
      for await (const row of state.all()) {
        // Consumer awaits must also be safe after the native snapshot finishes.
        await new Promise((resolve) => setTimeout(resolve, 0))
        rows.push(row)
      }
      expect(rows).toHaveLength(64)
      expect(rows.every((row) => row.versionId === 'v1')).toBe(true)
      expect(writer).toBeDefined()
      await writer
      expect((await state.get(entry(63).path))?.versionId).toBe('v2')
    } finally {
      await writer
      getAll.mockRestore()
      cursor.mockRestore()
      state.close()
      vi.unstubAllGlobals()
    }
  }
)
