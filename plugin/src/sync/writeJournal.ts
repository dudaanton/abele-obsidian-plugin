import { EngineError } from '@abele/sync-core'
import type { LocalStorage } from './ledgerId'

export const JOURNAL_KEY = 'abele-sync-writes'
export const RECOVERED_WRITES_KEY = 'abele-sync-recovered-writes'
export interface JournalEntry {
  target: string
  temp?: string
  backup?: string
  replacementSha?: string
  installed?: boolean
  /** Unfenced old inode must survive even if target contains exact replacement bytes. */
  preserveBackup?: boolean
}
export interface RecoveredWrite {
  target: string
  backup: string
  replacementSha?: string
}
const sameEntry = (a: JournalEntry, b: JournalEntry): boolean =>
  a.target === b.target && a.temp === b.temp && a.backup === b.backup

/** Local-only write intents and preservation decisions; neither travels with the vault. */
export class WriteJournal {
  constructor(private readonly storage: LocalStorage | null) {}

  private read(key: string): unknown[] {
    let raw: unknown
    try {
      raw = this.storage?.loadLocalStorage(key) ?? null
    } catch (cause) {
      throw new EngineError('io', 'cannot read the write journal', cause)
    }
    if (raw === null) return []
    if (!Array.isArray(raw)) throw new EngineError('io', 'the write journal is not an array')
    return raw
  }
  entries(): JournalEntry[] {
    const raw = this.read(JOURNAL_KEY)
    const entries = raw.filter((value): value is JournalEntry => {
      if (!value || typeof value !== 'object') return false
      const entry = value as JournalEntry
      return (
        typeof entry.target === 'string' &&
        (entry.temp === undefined || typeof entry.temp === 'string') &&
        (entry.backup === undefined || typeof entry.backup === 'string') &&
        (entry.preserveBackup === undefined || typeof entry.preserveBackup === 'boolean')
      )
    })
    if (entries.length !== raw.length)
      throw new EngineError('io', 'the write journal contains an unreadable entry')
    return entries
  }
  recovered(): RecoveredWrite[] {
    const raw = this.read(RECOVERED_WRITES_KEY)
    const entries = raw.filter(
      (value): value is RecoveredWrite =>
        !!value &&
        typeof value === 'object' &&
        typeof (value as RecoveredWrite).target === 'string' &&
        typeof (value as RecoveredWrite).backup === 'string'
    )
    if (entries.length !== raw.length)
      throw new EngineError('io', 'the preserved-copy journal contains an unreadable entry')
    return entries
  }
  protects(backup: string): boolean {
    return this.recovered().some((entry) => entry.backup === backup)
  }
  preserve(entry: JournalEntry): void {
    if (!entry.backup) throw new EngineError('io', 'there is no backup to preserve')
    const entries = this.recovered()
    if (entries.some((saved) => saved.backup === entry.backup)) return
    const saved: RecoveredWrite = {
      target: entry.target,
      backup: entry.backup,
      ...(entry.replacementSha === undefined ? {} : { replacementSha: entry.replacementSha }),
    }
    this.save(RECOVERED_WRITES_KEY, [...entries, saved])
  }
  add(entry: JournalEntry): void {
    this.save(JOURNAL_KEY, [...this.entries(), entry])
  }
  drop(entry: JournalEntry): void {
    this.save(
      JOURNAL_KEY,
      this.entries().filter((held) => !sameEntry(held, entry))
    )
  }
  replace(entry: JournalEntry, next: JournalEntry): void {
    this.save(
      JOURNAL_KEY,
      this.entries().map((held) => (sameEntry(held, entry) ? next : held))
    )
  }
  private save(key: string, entries: unknown[]): void {
    try {
      if (this.storage === null) throw new Error('no durable local storage')
      const value = entries.length === 0 ? null : entries
      this.storage.saveLocalStorage(key, value)
      if (JSON.stringify(this.storage.loadLocalStorage(key)) !== JSON.stringify(value))
        throw new Error('journal was not kept')
    } catch (cause) {
      throw new EngineError(
        'io',
        key === RECOVERED_WRITES_KEY
          ? 'cannot persist the preserved-copy decision; neither file was discarded'
          : 'cannot save the write journal; no replacement was started',
        cause
      )
    }
  }
}
