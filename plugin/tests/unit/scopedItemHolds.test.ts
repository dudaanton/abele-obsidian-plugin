import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ScopedState, type ScopedConnection, type ScopedJournal } from '@abele/sync-core'
import { AbeleError } from '@abele/sync-protocol'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { holdScopedItem, readScopedItemHolds } from '@/sync/scoped/itemHolds'

const binding: ScopedConnection = {
  version: 4,
  facet: 'scoped',
  endpoint_identity: 'https://sync.example.invalid',
  vault_id: 'sample-vault',
  grant_id: 'sample-grant',
  principal_id: 'sample-install',
  principal_kind: 'installation',
  credential_fingerprint: 'a'.repeat(64),
}
const journal: ScopedJournal = {
  kind: 'scoped',
  binding,
  request_id: 'sample-request',
  ops: [
    {
      op: 'modify',
      file_id: 'sample-file',
      base_version_id: 'sample-base',
      sha: 'b'.repeat(64),
      size: 3,
      mtime: 10,
    },
  ],
  startedAt: '2025-01-01T00:00:00Z',
  phase: 'staged',
  sources: [
    {
      index: 0,
      sourcePath: 'sample.md',
      stagedPath: '.abele-sync/scoped-outbox/sample-request/0-' + 'b'.repeat(64),
      sha: 'b'.repeat(64),
      size: 3,
      mtime: 10,
      base: null,
    },
  ],
}

it('retains the rejected request and exact staged source references after a restart', async () => {
  const factory = new IDBFactory()
  let raw = await IndexedDbStateStore.open(factory, 'sample-item-holds')
  const state = await ScopedState.open(raw, binding, { initialize: true })
  await state.setJournal(journal)
  await holdScopedItem(
    raw,
    state,
    journal.ops[0],
    new AbeleError('forbidden', 'sample protected membership')
  )
  raw.close()
  raw = await IndexedDbStateStore.open(factory, 'sample-item-holds')
  try {
    const reopened = await ScopedState.open(raw, binding)
    expect(await reopened.getJournal()).toBeNull()
    expect((await readScopedItemHolds(raw))[0].journal).toEqual(journal)
    expect((await readScopedItemHolds(raw))[0].ops).toEqual(journal.ops)
  } finally {
    raw.close()
  }
})

it('rolls back both writes if vacating the active slot fails', async () => {
  const raw = await IndexedDbStateStore.open(new IDBFactory(), 'sample-item-rollback')
  try {
    const state = await ScopedState.open(raw, binding, { initialize: true })
    await state.setJournal(journal)
    vi.spyOn(state, 'setJournal').mockRejectedValueOnce(new Error('interrupted'))
    await expect(
      holdScopedItem(raw, state, journal.ops[0], new AbeleError('quota_exceeded', 'sample quota'))
    ).rejects.toThrow('interrupted')
    expect(await state.getJournal()).toEqual(journal)
    expect(await readScopedItemHolds(raw)).toEqual([])
  } finally {
    raw.close()
  }
})
