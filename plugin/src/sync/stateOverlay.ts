import type { Journal, StateEntry } from '@abele/sync-core'

/**
 * The in-memory overlay a `transaction` of `IndexedDbStateStore` writes into, and the copies
 * that keep what the caller holds apart from what the store holds.
 */

/**
 * What an open `transaction` has written and not yet committed.
 *
 * `null` is a delete in both maps — no entry is null and no meta value is, since clearing the
 * journal or a plugin key is spelled as removing the row.
 *
 * `byFileId` and `byWirePath` index the live entries the way the database's own indexes do, so
 * a batch of a thousand puts costs a thousand map lookups rather than a thousand scans of
 * everything written so far, and so `put` can tell which keys the overlay can already answer
 * for without asking the database.
 */
export interface Overlay {
  entries: Map<string, StateEntry | null>
  /** fileId → the path the overlay currently holds it under. Live entries only. */
  byFileId: Map<string, string>
  /** wirePath → the path the overlay currently holds it under. Live entries only. */
  byWirePath: Map<string, string>
  meta: Map<string, unknown>
  /** Rejects if the transaction is rolled back, so a joined call fails with it. Never resolves. */
  discarded: Promise<never>
  /** Rejects `discarded`. */
  discard: (error: unknown) => void
}

export const newOverlay = (): Overlay => {
  let discard = (_error: unknown): void => undefined
  const discarded = new Promise<never>((_, reject) => (discard = reject))
  // Nothing joins most transactions, and a rejection nobody awaits is an unhandled one.
  void discarded.catch((): void => undefined)
  return {
    entries: new Map(),
    byFileId: new Map(),
    byWirePath: new Map(),
    meta: new Map(),
    discarded,
    discard,
  }
}

/** Writes an entry into the overlay and files it under both of its keys. */
export function overlayPut(overlay: Overlay, entry: StateEntry): void {
  overlayForget(overlay, entry.path)
  overlay.entries.set(entry.path, entry)
  overlay.byFileId.set(entry.fileId, entry.path)
  overlay.byWirePath.set(entry.wirePath, entry.path)
}

/** Marks a path deleted in the overlay, whatever the database still holds under it. */
export function overlayDelete(overlay: Overlay, path: string): void {
  overlayForget(overlay, path)
  overlay.entries.set(path, null)
}

/** Drops the index entries of whatever the overlay currently holds under `path`. */
export function overlayForget(overlay: Overlay, path: string): void {
  const held = overlay.entries.get(path)
  if (!held) return
  if (overlay.byFileId.get(held.fileId) === path) overlay.byFileId.delete(held.fileId)
  if (overlay.byWirePath.get(held.wirePath) === path) overlay.byWirePath.delete(held.wirePath)
}

export const copyEntry = (entry: StateEntry | null | undefined): StateEntry | null =>
  entry === null || entry === undefined ? null : { ...entry }

/**
 * A journal the caller and the store do not share, `ops` included: the engine appends to an
 * open journal in place, and a shared array would put a write inside a rolled-back transaction.
 */
export const copyJournal = (j: Journal | null): Journal | null =>
  j ? { ...j, ops: [...j.ops] } : null
