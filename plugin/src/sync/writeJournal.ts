import { EngineError } from '@abele/sync-sdk/core'
import type { LocalStorage } from './ledgerId'
import { durableHostOf, flushHostStorage, hostStorageOf } from './hostSyncStorage'
import { hostJournalId, type HostChange } from './hostSyncRecords'

export const JOURNAL_KEY = 'abele-sync-writes'
export const RECOVERED_WRITES_KEY = 'abele-sync-recovered-writes'
export interface JournalEntry {
  owner?: string
  /** Retained evidence from a server restore; never replayed or swept. */
  retiredGeneration?: string
  target: string
  temp?: string
  backup?: string
  replacementSha?: string
  installed?: boolean
  /** Unfenced old inode must survive even if target contains exact replacement bytes. */
  preserveBackup?: boolean
  /** Disposable verified-network cache, never a retained local edit or pending target. */
  disposableSource?: boolean
  /** A resumable chunk stage; retained until the engine explicitly discards it. */
  streaming?: {
    mtime: number
    base: { size: number; sha: string; mtime?: number } | null
    sealed?: { size: number; sha: string }
    /** Uncertain installed bytes survive publication as a recoverable backup. */
    retainBase?: boolean
  }
}
export interface RecoveredWrite {
  owner?: string
  target: string
  backup: string
  replacementSha?: string
}
const sameEntry = (a: JournalEntry, b: JournalEntry): boolean =>
  a.owner === b.owner && a.target === b.target && a.temp === b.temp && a.backup === b.backup
const identity = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const held = value as { size: number; sha: string }
  return (
    Number.isSafeInteger(held.size) &&
    held.size >= 0 &&
    typeof held.sha === 'string' &&
    /^[a-f0-9]{64}$/.test(held.sha)
  )
}

/** Local-only write intents and preservation decisions; neither travels with the vault. */
export class WriteJournal {
  constructor(
    private readonly storage: LocalStorage | null,
    private readonly assertMutation?: () => void,
    private readonly owner?: string,
    private readonly diagnostic?: (operation: string, startedAt: number, outcome: string) => void
  ) {}

  /** Commit independently of any SDK overlay before the caller starts its file effect. */
  async persist(work: () => void | Promise<void>): Promise<void> {
    await work()
    if (this.storage) await flushHostStorage(this.storage)
  }

  private owns(value: unknown): boolean {
    return (
      this.owner === undefined ||
      (!!value && typeof value === 'object' && Reflect.get(value, 'owner') === this.owner)
    )
  }
  private owned<T extends JournalEntry | RecoveredWrite>(entry: T): T {
    return this.owner === undefined ? entry : { ...entry, owner: this.owner }
  }

  private read(key: string): unknown[] {
    let raw: unknown
    try {
      raw = this.storage ? hostStorageOf(this.storage).loadLocalStorage(key) : null
    } catch (cause) {
      throw new EngineError('io', 'cannot read the write journal', cause)
    }
    if (raw === null) return []
    if (!Array.isArray(raw)) throw new EngineError('io', 'the write journal is not an array')
    return raw
  }
  entries(values = this.read(JOURNAL_KEY)): JournalEntry[] {
    if (!Array.isArray(values)) throw new EngineError('io', 'the write journal is not an array')
    const raw = values.filter((entry) => this.owns(entry))
    const entries = raw.filter((value): value is JournalEntry => {
      if (!value || typeof value !== 'object') return false
      const entry = value as JournalEntry
      return (
        typeof entry.target === 'string' &&
        (entry.owner === undefined ||
          (typeof entry.owner === 'string' && entry.owner.length > 0)) &&
        (entry.retiredGeneration === undefined || typeof entry.retiredGeneration === 'string') &&
        (entry.temp === undefined || typeof entry.temp === 'string') &&
        (entry.backup === undefined || typeof entry.backup === 'string') &&
        (entry.preserveBackup === undefined || typeof entry.preserveBackup === 'boolean') &&
        (entry.disposableSource === undefined || typeof entry.disposableSource === 'boolean') &&
        (entry.streaming === undefined ||
          (entry.temp !== undefined &&
            Number.isSafeInteger(entry.streaming?.mtime) &&
            entry.streaming.mtime >= 0 &&
            (entry.streaming.base === null || identity(entry.streaming.base)) &&
            (entry.streaming.retainBase === undefined ||
              typeof entry.streaming.retainBase === 'boolean') &&
            (entry.streaming.sealed === undefined || identity(entry.streaming.sealed))))
      )
    })
    if (entries.length !== raw.length)
      throw new EngineError('io', 'the write journal contains an unreadable entry')
    return entries
  }
  async currentEntries(): Promise<JournalEntry[]> {
    const host = this.storage && durableHostOf(this.storage)
    return host
      ? this.entries(((await host.readValue(JOURNAL_KEY)) as unknown[]) ?? [])
      : this.entries()
  }
  async currentEntry(temp: string): Promise<JournalEntry | undefined> {
    const host = this.storage && durableHostOf(this.storage)
    if (!host) return this.entries().find((entry) => entry.temp === temp)
    const values =
      this.owner === undefined
        ? await host.readPath(JOURNAL_KEY, temp)
        : [
            await host.readRecord(
              JOURNAL_KEY,
              hostJournalId({ owner: this.owner, temp, target: '' })
            ),
          ].filter((value) => value !== undefined)
    return this.entries(values).find((entry) => entry.temp === temp)
  }
  async currentForTargets(paths: readonly string[]): Promise<JournalEntry[]> {
    const host = this.storage && durableHostOf(this.storage)
    return host
      ? this.entries(await host.readTargets(JOURNAL_KEY, paths))
      : this.entries().filter((entry) => paths.includes(entry.target))
  }
  async isCurrent(entry: JournalEntry): Promise<boolean> {
    const host = this.storage && durableHostOf(this.storage)
    const owned = this.owned(entry)
    const current = host
      ? await host.readRecord(JOURNAL_KEY, hostJournalId(owned))
      : this.entries().find((value) => sameEntry(value, owned))
    return JSON.stringify(current) === JSON.stringify(owned)
  }
  async currentRecovered(): Promise<RecoveredWrite[]> {
    const host = this.storage && durableHostOf(this.storage)
    return host
      ? this.recovered(((await host.readValue(RECOVERED_WRITES_KEY)) as unknown[]) ?? [])
      : this.recovered()
  }
  async currentVaultRecovered(): Promise<RecoveredWrite[]> {
    return (await this.currentRecovered()).filter(
      (entry) => !entry.backup.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(entry.backup)
    )
  }
  async currentProtects(backup: string): Promise<boolean> {
    const host = this.storage && durableHostOf(this.storage)
    return host
      ? this.recovered(await host.readPath(RECOVERED_WRITES_KEY, backup)).some(
          (entry) => entry.backup === backup
        )
      : this.protects(backup)
  }
  async currentRetainsTemp(path: string): Promise<boolean> {
    const host = this.storage && durableHostOf(this.storage)
    return host
      ? (await host.readPath(JOURNAL_KEY, path)).some(
          (entry) => !!entry && typeof entry === 'object' && Reflect.get(entry, 'temp') === path
        )
      : this.retainsTemp(path)
  }
  recovered(values = this.read(RECOVERED_WRITES_KEY)): RecoveredWrite[] {
    if (!Array.isArray(values))
      throw new EngineError('io', 'the preserved-copy journal is not an array')
    const raw = values.filter((entry) => this.owns(entry))
    const entries = raw.filter(
      (value): value is RecoveredWrite =>
        !!value &&
        typeof value === 'object' &&
        ((value as RecoveredWrite).owner === undefined ||
          (typeof (value as RecoveredWrite).owner === 'string' &&
            (value as RecoveredWrite).owner.length > 0)) &&
        typeof (value as RecoveredWrite).target === 'string' &&
        typeof (value as RecoveredWrite).backup === 'string'
    )
    if (entries.length !== raw.length)
      throw new EngineError('io', 'the preserved-copy journal contains an unreadable entry')
    return entries
  }
  async retireGeneration(
    generation: string,
    archive: (value: unknown) => Promise<void>
  ): Promise<void> {
    const entries = await this.currentEntries()
    const archived = new Set(entries.map((entry) => JSON.stringify(entry)))
    await archive(entries)
    if (this.storage && durableHostOf(this.storage)) {
      const current = await this.currentEntries()
      await this.persist(() => {
        for (const entry of current)
          if (entry.retiredGeneration === undefined && archived.has(JSON.stringify(entry)))
            this.replace(entry, {
              ...entry,
              retiredGeneration: generation,
            })
      })
      return
    }
    // Re-read after the asynchronous durable archive; another connection may have appended.
    this.save(
      JOURNAL_KEY,
      this.read(JOURNAL_KEY).map((value) =>
        this.owns(value) && archived.has(JSON.stringify(value))
          ? {
              ...(value as JournalEntry),
              retiredGeneration: (value as JournalEntry).retiredGeneration ?? generation,
            }
          : value
      )
    )
    if (this.storage) await flushHostStorage(this.storage)
  }
  protects(backup: string): boolean {
    return this.recovered().some((entry) => entry.backup === backup)
  }
  /** Ownership inventory only: a scan must not sweep another owner's or legacy temp. */
  retainsTemp(path: string): boolean {
    return this.read(JOURNAL_KEY).some(
      (entry) => !!entry && typeof entry === 'object' && Reflect.get(entry, 'temp') === path
    )
  }
  vaultRecovered(): RecoveredWrite[] {
    return this.recovered().filter(
      (entry) => !entry.backup.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(entry.backup)
    )
  }
  /** Explicitly followed placement changes only settled evidence labels, never file bytes. */
  async relocateRecoveredTargets(from: string, to: string): Promise<void> {
    if (this.storage && durableHostOf(this.storage)) {
      for (const entry of await this.currentRecovered())
        if (entry.target === from || entry.target.startsWith(from + '/'))
          this.change(RECOVERED_WRITES_KEY, entry, {
            ...entry,
            target: to + entry.target.slice(from.length),
          })
      return
    }
    this.recovered()
    this.save(
      RECOVERED_WRITES_KEY,
      this.read(RECOVERED_WRITES_KEY).map((value) => {
        const entry = value as RecoveredWrite
        return this.owns(entry) && (entry.target === from || entry.target.startsWith(from + '/'))
          ? { ...entry, target: to + entry.target.slice(from.length) }
          : entry
      })
    )
  }
  async relocateRecovered(from: string, to: string): Promise<void> {
    if (this.storage && durableHostOf(this.storage)) {
      const host = durableHostOf(this.storage)
      for (const entry of this.recovered(await host.readPath(RECOVERED_WRITES_KEY, from)))
        this.change(RECOVERED_WRITES_KEY, entry, { ...entry, backup: to })
      return
    }
    this.recovered()
    this.save(
      RECOVERED_WRITES_KEY,
      this.read(RECOVERED_WRITES_KEY).map((entry) =>
        this.owns(entry) && (entry as RecoveredWrite).backup === from
          ? { ...(entry as RecoveredWrite), backup: to }
          : entry
      )
    )
  }
  preserve(entry: JournalEntry): void {
    if (!entry.backup) throw new EngineError('io', 'there is no backup to preserve')
    if (this.storage && durableHostOf(this.storage)) {
      this.change(
        RECOVERED_WRITES_KEY,
        undefined,
        this.owned({
          target: entry.target,
          backup: entry.backup,
          ...(entry.owner ? { owner: entry.owner } : {}),
          ...(entry.replacementSha === undefined ? {} : { replacementSha: entry.replacementSha }),
        })
      )
      return
    }
    const entries = this.recovered()
    if (entries.some((saved) => saved.backup === entry.backup)) return
    const saved: RecoveredWrite = this.owned({
      ...(entry.owner ? { owner: entry.owner } : {}),
      target: entry.target,
      backup: entry.backup,
      ...(entry.replacementSha === undefined ? {} : { replacementSha: entry.replacementSha }),
    })
    this.save(RECOVERED_WRITES_KEY, [...this.read(RECOVERED_WRITES_KEY), saved])
  }
  add(entry: JournalEntry): void {
    if (this.change(JOURNAL_KEY, undefined, this.owned(entry))) return
    this.entries()
    this.save(JOURNAL_KEY, [...this.read(JOURNAL_KEY), this.owned(entry)])
  }
  drop(entry: JournalEntry): void {
    if (this.change(JOURNAL_KEY, this.owned(entry), undefined)) return
    this.entries()
    this.save(
      JOURNAL_KEY,
      this.read(JOURNAL_KEY).filter(
        (held) => !this.owns(held) || !sameEntry(held as JournalEntry, this.owned(entry))
      )
    )
  }
  replace(entry: JournalEntry, next: JournalEntry): void {
    if (this.change(JOURNAL_KEY, this.owned(entry), this.owned(next))) return
    this.entries()
    this.save(
      JOURNAL_KEY,
      this.read(JOURNAL_KEY).map((held) =>
        this.owns(held) && sameEntry(held as JournalEntry, this.owned(entry))
          ? this.owned(next)
          : held
      )
    )
  }
  private change(
    key: string,
    before: JournalEntry | RecoveredWrite | undefined,
    after: JournalEntry | RecoveredWrite | undefined
  ): boolean {
    const host = this.storage && durableHostOf(this.storage)
    if (!host) return false
    const startedAt = Date.now()
    let outcome = 'failed'
    try {
      this.assertMutation?.()
      const priorId = before && hostJournalId(before),
        nextId = after && hostJournalId(after)
      const changes: HostChange[] = []
      if (priorId && priorId !== nextId)
        changes.push({ key, id: priorId, before, after: undefined })
      if (nextId)
        changes.push({ key, id: nextId, before: priorId === nextId ? before : undefined, after })
      host.changeRecords(changes)
      outcome = 'complete'
      return true
    } finally {
      this.diagnostic?.('journal save', startedAt, outcome)
    }
  }
  private save(key: string, entries: unknown[]): void {
    const startedAt = Date.now()
    let outcome = 'failed'
    try {
      this.assertMutation?.()
      if (this.storage === null) throw new Error('no durable local storage')
      const value = entries.length === 0 ? null : entries
      const storage = hostStorageOf(this.storage)
      storage.saveLocalStorage(key, value)
      if (JSON.stringify(storage.loadLocalStorage(key)) !== JSON.stringify(value))
        throw new Error('journal was not kept')
      outcome = 'complete'
    } catch (cause) {
      throw new EngineError(
        'io',
        key === RECOVERED_WRITES_KEY
          ? 'cannot persist the preserved-copy decision; neither file was discarded'
          : 'cannot save the write journal; no replacement was started',
        cause
      )
    } finally {
      this.diagnostic?.('journal save', startedAt, outcome)
    }
  }
}
