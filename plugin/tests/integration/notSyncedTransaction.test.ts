// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { NotSyncedState } from '@/sync/notSyncedState'
import { deferred } from '../helpers/deferred'
import { STATE_PROJECTION_PASS } from '@/sync/stateProjectionPass'

it('serializes durable status projection behind an active engine transaction', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-status-transaction')
  const entered = deferred(),
    release = deferred(),
    queued = deferred()
  const engine = state.transaction(async (tx) => {
    await tx.setCursor(7)
    entered.resolve()
    await release.promise
  })
  void engine.catch(() => {})
  await entered.promise
  const method =
    typeof Reflect.get(state, STATE_PROJECTION_PASS) === 'function'
      ? STATE_PROJECTION_PASS
      : 'transaction'
  const transaction = Reflect.get(state, method).bind(state)
  const spy = vi.spyOn(state, method as 'transaction').mockImplementation((work) => {
    queued.resolve()
    return transaction(work)
  })
  const list = new NotSyncedState(state)
  const snapshot = list.snapshot()
  try {
    // The old reader finishes (and writes the summary) during the overlay. A serialized
    // reader instead queues behind it. No scheduling delay or timeout chooses the order.
    await Promise.race([snapshot, queued.promise])
    release.resolve()
    await expect(engine).resolves.toBeUndefined()
    expect(await snapshot).toEqual([])
    expect(await state.getCursor()).toBe(7)
    expect(await state.getMeta('not-synced-v1')).toBe('[]')
  } finally {
    release.resolve()
    await Promise.allSettled([engine, snapshot])
    spy.mockRestore()
    state.close()
  }
})

it('keeps the external filesystem boundary available during a status projection', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-status-external')
  const entered = deferred(),
    release = deferred()
  await state.setMeta(
    'not-synced-outgoing:sample.bin',
    JSON.stringify({ path: 'sample.bin', reason: 'too_large: limit' })
  )
  const list = new NotSyncedState(state, async () => {
    entered.resolve()
    await release.promise
    return { size: 8 }
  })
  const snapshot = list.snapshot()
  try {
    await entered.promise
    await expect(state.getExternalState()).resolves.toBeNull()
  } finally {
    release.resolve()
    await snapshot
    state.close()
  }
})

it('resolves an unrefused file in an engine callback without starting a status projection', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-status-callback')
  const list = new NotSyncedState(state)
  const inventory = vi.spyOn(state, 'metadataKeys')
  try {
    await expect(
      state.transaction(async (tx) => {
        await tx.setCursor(9)
        await list.resolved('Notes/sample.md')
      })
    ).resolves.toBeUndefined()
    expect(await state.getCursor()).toBe(9)
    expect(await state.getMeta('not-synced-v1')).toBeNull()
    expect(inventory).not.toHaveBeenCalled()
  } finally {
    state.close()
  }
})
