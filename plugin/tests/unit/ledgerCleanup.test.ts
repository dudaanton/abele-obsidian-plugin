import { expect, it } from 'vitest'
import {
  LEDGER_CLEANUP_KEY,
  ledgerCleanupIds,
  rememberLedgerCleanup,
  finishLedgerCleanup,
} from '@/sync/ledgerCleanup'
function storage() {
  const values = new Map<string, unknown>()
  return {
    values,
    loadLocalStorage: (key: string) => values.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, value)
    },
  }
}
it('deduplicates owned tombstones and removes only successful deletions', () => {
  const local = storage()
  rememberLedgerCleanup(local, 'sample-old', 'sample-current', 'sample-old')
  finishLedgerCleanup(local, 'sample-current')
  expect(ledgerCleanupIds(local)).toEqual(['sample-old'])
  finishLedgerCleanup(local, 'sample-old')
  expect(local.loadLocalStorage(LEDGER_CLEANUP_KEY)).toBeNull()
})
it('refuses unreadable tombstones instead of losing their ownership evidence', () => {
  const local = storage()
  local.values.set(LEDGER_CLEANUP_KEY, { malformed: true })
  expect(() => rememberLedgerCleanup(local, 'sample-new')).toThrow(/unreadable/)
  expect(local.loadLocalStorage(LEDGER_CLEANUP_KEY)).toEqual({ malformed: true })
})
it('refuses clearing a tombstone when local storage did not persist the acknowledgement', () => {
  const local = storage()
  rememberLedgerCleanup(local, 'sample-state')
  expect(() =>
    finishLedgerCleanup({ ...local, saveLocalStorage: () => {} }, 'sample-state')
  ).toThrow(/not persisted/)
  expect(ledgerCleanupIds(local)).toEqual(['sample-state'])
})
