import { expect } from 'vitest'
import type { Journal, StateEntry, StateStore } from '@abele/sync-sdk/core'

/** Shared with host adapters: an unrelated task must never join a suspended transaction. */
export async function rollbackIsolation(store: StateStore): Promise<void> {
  const entry: StateEntry = {
    path: 'shared.md',
    wirePath: 'shared.md',
    fileId: 'shared',
    versionId: 'outside',
    sha: 'a'.repeat(64),
    size: 1,
    mtime: 1,
  }
  const journal: Journal = {
    batchId: 'outside',
    idempotencyKey: 'outside',
    startedAt: '2026-01-01T00:00:00Z',
    ops: [],
  }
  await store.setMeta!('shared', 'before')
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>((resolve) => {
    entered = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const operation = store.transaction(async (tx) => {
    expect(tx).not.toBe(store)
    await tx.setMeta!('tentative', 'private')
    await tx.setMeta!('shared', 'transaction')
    await tx.put({ ...entry, versionId: 'tentative' })
    await tx.setCursor(1)
    await tx.setJournal({ ...journal, batchId: 'tentative' })
    entered()
    await gate
    expect(await tx.getMeta!('tentative')).toBe('private')
    expect((await tx.byFileId('shared'))?.versionId).toBe('tentative')
    throw new Error('rollback')
  })
  const rejected = expect(operation).rejects.toThrow('rollback')
  await ready
  expect(await store.getMeta!('tentative')).toBeNull()
  await store.setMeta!('unrelated', 'survives')
  await store.setMeta!('shared', 'unrelated wins')
  await store.put(entry)
  await store.setCursor(42)
  await store.setJournal(journal)
  release()
  await rejected
  expect(await store.getMeta!('unrelated')).toBe('survives')
  expect(await store.getMeta!('shared')).toBe('unrelated wins')
  expect(await store.getMeta!('tentative')).toBeNull()
  expect(await store.get('shared.md')).toEqual(entry)
  expect(await store.byFileId('shared')).toEqual(entry)
  expect(await store.getCursor()).toBe(42)
  expect(await store.getJournal()).toEqual(journal)
}
