import { expect, it, vi } from 'vitest'
import { MemoryStateStore, type Journal } from '@abele/sync-sdk/core'
import { localOnlyJournalState, quarantineLocalOnlyJournal } from '@/sync/localOnlyJournal'

const pending = (): Journal => ({
  batchId: 'sample-batch',
  idempotencyKey: 'sample-key',
  startedAt: '2026-01-01T00:00:00Z',
  ops: [
    { op: 'create', path: 'Kept.md', sha: 'a'.repeat(64), size: 1, mtime: 1 },
    { op: 'create', path: 'Other.md', sha: 'b'.repeat(64), size: 1, mtime: 1 },
  ],
})
it('retains the entire immutable mixed batch before removing its replay slot', async () => {
  const state = new MemoryStateStore(),
    journal = pending()
  await state.setJournal(journal)
  await quarantineLocalOnlyJournal(state, (path) => path === 'Kept.md')
  expect(await state.getJournal()).toBe(null)
  expect(JSON.parse((await state.getMeta('local-only-publication-journal:sample-key'))!)).toEqual(
    journal
  )
})
it('preserves the replay slot if durable quarantine fails', async () => {
  const state = new MemoryStateStore(),
    journal = pending()
  await state.setJournal(journal)
  vi.spyOn(state, 'setMeta').mockRejectedValue(new Error('Storage unavailable'))
  await expect(quarantineLocalOnlyJournal(state, () => true)).rejects.toThrow('Storage unavailable')
  expect(await state.getJournal()).toEqual(journal)
})
it('leaves unrelated publication intact and blocks a newly fenced batch before sending', async () => {
  const state = new MemoryStateStore(),
    journal = pending()
  await state.setJournal(journal)
  await quarantineLocalOnlyJournal(state, () => false)
  expect(await state.getJournal()).toEqual(journal)
  await state.setJournal(null)
  const guarded = localOnlyJournalState(state, (path) => path === 'Kept.md')
  await expect(guarded.setJournal(journal)).rejects.toThrow('cannot be published')
  expect(await state.getJournal()).toBe(null)
  expect(await state.getMeta('local-only-publication-journal:sample-key')).not.toBe(null)
})
import { retireLocalOnlyLedger } from '@/sync/localOnlyJournal'

it('retires the deleted server identity before a retained copy returns to publication', async () => {
  const state = new MemoryStateStore()
  const entry = {
    path: 'Shared/Kept.md',
    wirePath: 'Shared/Kept.md',
    fileId: 'deleted-file',
    versionId: 'old-version',
    sha: 'a'.repeat(64),
    size: 4,
    mtime: 1,
  }
  await state.put(entry)
  await state.put({ ...entry, path: 'Other.md', wirePath: 'Other.md', fileId: 'live-file' })
  await retireLocalOnlyLedger(state, (path) => path === entry.path)
  expect(await state.get(entry.path)).toBe(null)
  expect(await state.byFileId(entry.fileId)).toBe(null)
  expect(await state.get('Other.md')).not.toBe(null)
})
