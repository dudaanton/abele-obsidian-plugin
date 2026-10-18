// @vitest-environment node
import { IDBDatabase, IDBFactory } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

const pass = Symbol.for('abele.sync.normalization-pass-v1')
const keys = ['normalization-collisions', 'normalization-directory-collisions']

it('reads normalization metadata once per pass and refreshes it between passes', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-normalization')
  let reads = 0
  const transaction = IDBDatabase.prototype.transaction
  const spy = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (...args) {
    if (args[1] !== 'readwrite') reads++
    return transaction.apply(this, args)
  })
  try {
    await Reflect.get(state, pass).call(state, async () => {
      for (let i = 0; i < 32; i++)
        for (const key of keys) expect(await state.getMeta(key)).toBeNull()
    })
    expect(reads).toBeLessThanOrEqual(4)
    const first = reads
    await Reflect.get(state, pass).call(state, () => state.getMeta(keys[0]))
    expect(reads).toBeGreaterThan(first)
    console.log('[normalization metadata reads]', { lookups: 64, firstPassReads: first })
  } finally {
    spy.mockRestore()
    state.close()
  }
})

it('invalidates cached holds on writes and never retains rolled-back holds', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-normalization-writes')
  try {
    await Reflect.get(state, pass).call(state, async () => {
      for (const key of keys) {
        expect(await state.getMeta(key)).toBeNull()
        await state.setMeta(key, '[]')
        expect(await state.getMeta(key)).toBe('[]')
        await expect(
          state.transaction(async () => {
            await state.setMeta(key, '["sample hold"]')
            expect(await state.getMeta(key)).toBe('["sample hold"]')
            throw new Error('sample rollback')
          })
        ).rejects.toThrow('sample rollback')
        expect(await state.getMeta(key)).toBe('[]')
        await state.transaction(async () => {
          await state.setMeta(key, null)
        })
        expect(await state.getMeta(key)).toBeNull()
      }
    })
  } finally {
    state.close()
  }
})
