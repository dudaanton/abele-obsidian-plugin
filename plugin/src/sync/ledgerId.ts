/**
 * Which ledger this local vault syncs on, kept where no file can carry it.
 *
 * The ledger is an IndexedDB database, and IndexedDB is one namespace for every vault the app
 * has open — so the name it is filed under must belong to this local vault and to nothing that
 * can be copied out of it. `data.json` is the opposite: a transfer carries it, a Finder copy of
 * the vault carries it, Syncthing and git carry it. A ledger id that arrived that way would open
 * another vault's ledger, find none of its files on this disk, and push a delete for each one.
 *
 * Obsidian's `loadLocalStorage`/`saveLocalStorage` are scoped to the vault by the app's own id
 * for it, which a copied folder does not share — the same place Obsidian keeps each vault's
 * keychain. What is kept is the id and the server vault the ledger describes.
 */

/** The key the record is filed under in this vault's local storage. */
export const LEDGER_KEY = 'abele-sync-ledger'

/** A ledger: the database's own id, and the server vault its entries belong to. */
export interface LedgerId {
  stateId: string
  vaultId: string
}

/** No ledger at all: nothing enrolled here yet, or `forget` threw it away. */
export const NO_LEDGER: LedgerId = Object.freeze({ stateId: '', vaultId: '' })

/** What reads and writes this vault's local storage — the `App`, in the running plugin. */
export interface LocalStorage {
  loadLocalStorage(key: string): unknown
  saveLocalStorage(key: string, data: unknown): void
}

/**
 * The record as it stands. None at all, or one that is malformed, reads as no ledger, and the
 * next build mints one: a ledger is a cache of what the server holds, so a fresh one costs a walk
 * of the manifest and deletes nothing.
 */
export function readLedgerId(storage: LocalStorage): LedgerId {
  const raw = storage.loadLocalStorage(LEDGER_KEY)
  if (raw === null || typeof raw !== 'object') return { ...NO_LEDGER }
  const o = raw as Record<string, unknown>
  return {
    stateId: typeof o.stateId === 'string' ? o.stateId : '',
    vaultId: typeof o.vaultId === 'string' ? o.vaultId : '',
  }
}

export function writeLedgerId(storage: LocalStorage, ledger: LedgerId): void {
  storage.saveLocalStorage(LEDGER_KEY, { stateId: ledger.stateId, vaultId: ledger.vaultId })
}
