// @vitest-environment node
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

it('loads entries once per pass and retires the snapshot after writes and rollback', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-startup-bulk')
  const read = async () => {
    const rows = []
    for await (const row of state.all()) rows.push(row)
    return rows
  }
  const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  try {
    await Reflect.get(state, Symbol.for('abele.sync.normalization-pass-v1')).call(
      state,
      async () => {
        await read()
        const before = getAll.mock.calls.length
        await read()
        expect(getAll.mock.calls.length).toBe(before)
        await state.put({
          path: 'sample.md',
          wirePath: 'sample.md',
          fileId: 'file',
          versionId: 'v1',
          sha: 'a'.repeat(64),
          size: 1,
          mtime: 1,
        })
        expect(await read()).toHaveLength(1)
        await expect(
          state.transaction(async (tx) => {
            await tx.delete('sample.md')
            throw new Error('rollback')
          })
        ).rejects.toThrow('rollback')
        expect(await read()).toHaveLength(1)
        await state.delete('sample.md')
        expect(await read()).toEqual([])
      }
    )
  } finally {
    getAll.mockRestore()
    state.close()
  }
})
