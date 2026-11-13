// @vitest-environment node
import { IDBFactory, IDBCursor } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { WriteJournal, JOURNAL_KEY, RECOVERED_WRITES_KEY } from '@/sync/writeJournal'
import { RECORDS, recordKey } from '@/sync/hostSyncSchema'
import { completion } from '@/sync/idbRequests'

it('keeps the journal header validation on an owner-specific read', async () => {
  const local = { loadLocalStorage: () => null, saveLocalStorage: () => {} }
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-header', local)
  try {
    host.saveLocalStorage(JOURNAL_KEY, [
      { owner: 'selected', target: 'sample.md', temp: 'sample.tmp' },
    ])
    await host.flush()
    const db = Reflect.get(host, 'db') as IDBDatabase
    const tx = db.transaction(RECORDS, 'readwrite')
    const done = completion(tx)
    tx.objectStore(RECORDS).delete(recordKey('sample-header', JOURNAL_KEY, '!header'))
    await done
    await expect(new WriteJournal(local, undefined, 'selected').currentEntries()).rejects.toThrow(
      'header'
    )
  } finally {
    host.close()
  }
})

it('reads one connection journal without visiting thousands of retained rows from other owners', async () => {
  const local = { loadLocalStorage: () => null, saveLocalStorage: () => {} }
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-owner-read', local)
  try {
    for (const key of [JOURNAL_KEY, RECOVERED_WRITES_KEY]) {
      host.saveLocalStorage(key, [
        ...Array.from({ length: 4000 }, (_, i) => ({
          owner: 'other-connection',
          target: `sample-${i}.md`,
          ...(key === JOURNAL_KEY ? { temp: `private-${i}.tmp` } : { backup: `private-${i}.bin` }),
        })),
        {
          owner: 'selected-connection',
          target: 'selected.md',
          ...(key === JOURNAL_KEY ? { temp: 'selected.tmp' } : { backup: 'selected.bin' }),
        },
      ])
    }
    await host.flush()
    const steps = vi.spyOn(IDBCursor.prototype, 'continue')
    try {
      const journal = new WriteJournal(local, undefined, 'selected-connection')
      expect(await journal.currentEntries()).toHaveLength(1)
      expect(await journal.currentRecovered()).toHaveLength(1)
      expect(steps.mock.calls.length).toBeLessThanOrEqual(8)
    } finally {
      steps.mockRestore()
    }
  } finally {
    host.close()
  }
})
