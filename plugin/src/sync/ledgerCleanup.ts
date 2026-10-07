import type { LocalStorage } from './ledgerId'

/** Vault-local deletion tombstones. Never enumerate the app-wide IndexedDB namespace. */
export const LEDGER_CLEANUP_KEY = 'abele-sync-ledger-cleanup'
export function ledgerCleanupIds(storage: LocalStorage): string[] {
  const raw = storage.loadLocalStorage(LEDGER_CLEANUP_KEY)
  if (raw == null) return []
  if (
    !Array.isArray(raw) ||
    raw.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id))
  )
    throw new Error('Ledger cleanup tombstones are unreadable; recovery required')
  return [...new Set(raw)]
}
function save(storage: LocalStorage, ids: string[]): void {
  const value = ids.length ? ids : null
  storage.saveLocalStorage(LEDGER_CLEANUP_KEY, value)
  if (
    JSON.stringify(storage.loadLocalStorage(LEDGER_CLEANUP_KEY) ?? null) !== JSON.stringify(value)
  )
    throw new Error('Ledger cleanup tombstones were not persisted')
}
export function rememberLedgerCleanup(storage: LocalStorage, ...ids: string[]): void {
  if (ids.some((id) => id && !/^[a-zA-Z0-9_-]+$/.test(id)))
    throw new Error('Ledger cleanup identity is unreadable; recovery required')
  save(storage, [...new Set([...ledgerCleanupIds(storage), ...ids.filter(Boolean)])])
}
export function finishLedgerCleanup(storage: LocalStorage, id: string): void {
  save(
    storage,
    ledgerCleanupIds(storage).filter((held) => held !== id)
  )
}
