// @vitest-environment node
import { IDBFactory, IDBObjectStore, IDBKeyRange } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

it('never deserializes unrelated metadata when seeking an empty prefix', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-prefix-range')
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  try {
    await state.setMeta('unrelated-large-record', 'x'.repeat(1024 * 1024))
    expect(
      await Reflect.get(state, Symbol.for('abele.sync.metadata-prefix-v1')).call(state, 'absent:')
    ).toEqual(new Map())
    const ranges = getAll.mock.calls.map(([range]) => range as IDBKeyRange)
    expect(ranges.length).toBeGreaterThan(0)
    expect(ranges.every((range) => !range.includes('plugin:unrelated-large-record'))).toBe(true)
  } finally {
    getAll.mockRestore()
    vi.unstubAllGlobals()
    state.close()
  }
})

it('lets a host task run while indexing an already loaded ledger snapshot', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-snapshot-yield')
  let ticks = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => ticks)
  let heartbeat = false
  let task: Promise<void> | undefined
  try {
    await Reflect.get(state, Symbol.for('abele.sync.normalization-pass-v1')).call(
      state,
      async () => {
        // Model a slow device's map construction without spending CPU or loading a large DB.
        const rows = Array.from({ length: 1024 }, (_, i) => ({
          get path() {
            ticks++
            return `sample-${i}.md`
          },
          wirePath: `sample-${i}.md`,
          fileId: `sample-${i}`,
          versionId: 'v1',
          sha: 'a'.repeat(64),
          size: 1,
          mtime: 1,
        }))
        Reflect.set(state, 'entrySnapshot', Promise.resolve(rows))
        task = new Promise((resolve) =>
          setTimeout(() => {
            heartbeat = true
            resolve()
          }, 0)
        )
        expect((await state.get('sample-999.md'))?.fileId).toBe('sample-999')
        expect(heartbeat).toBe(true)
      }
    )
  } finally {
    await task
    clock.mockRestore()
    state.close()
  }
})

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
