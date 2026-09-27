import type { LocalStorage } from './ledgerId'

/**
 * The idempotency key each "Restore all deleted since" batch went out under, kept in the vault's
 * local storage until a restore gets through (pi review #8).
 *
 * A batch whose answer was lost is sent again under the key it first had, so the server answers
 * with what it did then — restored — rather than `not_found` for files it already took out of the
 * trash. Kept in a component, the key went with the dialog: closed and opened again, or Obsidian
 * restarted, the retry was a new request. Filed by server vault and by the exact files of a batch;
 * a key older than a day is forgotten, since a retry that late is a new restore.
 */

const KEY = 'abele-sync-restore-keys'
const KEPT_MS = 24 * 60 * 60 * 1000

interface Held {
  key: string
  at: number
}

type Filed = Record<string, Record<string, Held>>

/** Where they are kept when there is no local storage: until Obsidian closes. */
const memory: Filed = {}

export class RestoreKeys {
  constructor(
    private readonly storage: LocalStorage | null,
    private readonly vaultId: string,
    private readonly mint: () => string,
    private readonly now: () => number = Date.now
  ) {}

  /** The key this batch went out under before, or a new one, kept until `clear`. */
  keyOf(ids: readonly string[]): string {
    const batch = ids.join(' ')
    const filed = this.read()
    const own = filed[this.vaultId] ?? {}
    const held = own[batch]
    if (held !== undefined) return held.key
    const key = this.mint()
    this.write({ ...filed, [this.vaultId]: { ...own, [batch]: { key, at: this.now() } } })
    return key
  }

  /** A restore got through: this vault's keys are done with. */
  clear(): void {
    const filed = this.read()
    if (!(this.vaultId in filed)) return
    const rest = { ...filed }
    delete rest[this.vaultId]
    this.write(rest)
  }

  private read(): Filed {
    let raw: unknown = memory
    if (this.storage !== null) {
      try {
        raw = this.storage.loadLocalStorage(KEY)
      } catch {
        raw = null
      }
    }
    const out: Filed = {}
    if (raw === null || typeof raw !== 'object') return out
    const oldest = this.now() - KEPT_MS
    for (const [vault, batches] of Object.entries(raw as Record<string, unknown>)) {
      if (batches === null || typeof batches !== 'object') continue
      for (const [batch, held] of Object.entries(batches as Record<string, unknown>)) {
        const one = held as Partial<Held> | null
        if (typeof one?.key !== 'string' || typeof one.at !== 'number' || one.at < oldest) continue
        out[vault] = { ...(out[vault] ?? {}), [batch]: { key: one.key, at: one.at } }
      }
    }
    return out
  }

  private write(filed: Filed): void {
    if (this.storage === null) {
      for (const vault of Object.keys(memory)) delete memory[vault]
      Object.assign(memory, filed)
      return
    }
    try {
      this.storage.saveLocalStorage(KEY, Object.keys(filed).length === 0 ? null : filed)
    } catch (error) {
      // A retry then goes as a new request: at worst `not_found` for files already back.
      console.debug('[abele-sync] the restore keys could not be kept', error)
    }
  }
}
