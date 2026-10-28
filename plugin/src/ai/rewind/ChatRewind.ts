import { UiError, uiMessage } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
/**
 * One chat's rewind log: what its agent changed in the vault, turn by turn, and the way back.
 *
 * Each tool receives an owned file facade. Its changes land here under the chat, run and user
 * message captured at invocation, never under whichever chat happens to be active later.
 * The log is written after each change, in the plugin's folder on this device (see
 * `RewindStore`), and kept under the size the settings allow — the chats
 * written to least recently go first.
 */
import { shallowRef, type ShallowRef } from 'vue'
import { Notice, type App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ChangeTracker, type Recording } from './ChangeTracker'
import { adapterStore, type RewindStore } from './RewindStore'
import { VaultFs } from './vaultFs'
import { applyRestore, planRestore, UNOWNED_RECORDING } from './restore'
import type {
  Change,
  ConflictChoice,
  RestorePlan,
  RestoreResult,
  RewindEntry,
  RewindLogFile,
} from './types'

export const DEFAULT_REWIND_LIMIT_MB = 100

/** What the log needs from its chat. */
export interface RewindHost {
  /** The chat's lasting name for its log: the id of its first message. Null before there is one. */
  key(): string | null
  /** The user message whose turn is running now. */
  turn(): string | null
}

/** The cap in bytes; zero means nothing is recorded. */
export function rewindLimitBytes(): number {
  const mb = AbeleConfig.getInstance().ai.rewindLimitMb
  const value = typeof mb === 'number' && mb >= 0 ? mb : DEFAULT_REWIND_LIMIT_MB
  return value * 1024 * 1024
}

export class ChatRewind implements Recording {
  /** The entries, oldest first. Replaced, never mutated, so a view watching it redraws. */
  private readonly journalEntries = shallowRef<RewindEntry[]>([])
  private readonly journals = new Map<string, ChatRewind>()

  get entries(): ShallowRef<RewindEntry[]> {
    return this.journalKey ? this.journalEntries : (this.journal()?.entries ?? this.journalEntries)
  }

  private loadedKey: string | null = null
  private loading: Promise<void> | null = null
  private pendingBlobs = new Map<string, ArrayBuffer>()
  private dirty = false
  private failureNotified = false
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly app: App,
    private readonly host: RewindHost,
    private readonly store: RewindStore = adapterStore(app),
    private readonly journalKey?: string
  ) {}

  /** A mutable host selects a journal; it never becomes that journal's persistence identity. */
  private journal(key = this.host.key()): ChatRewind | null {
    if (this.journalKey) return this
    if (!key) return null
    let journal = this.journals.get(key)
    if (!journal) {
      journal = new ChatRewind(
        this.app,
        { key: () => key, turn: () => this.host.turn() },
        this.store,
        key
      )
      this.journals.set(key, journal)
    }
    return journal
  }

  /** Call-local recording, passed explicitly through ToolContext.app. */
  track(
    tool: string,
    run: string,
    turn = this.host.turn(),
    isCurrent: () => boolean = () => true
  ): { app: App; close: () => Promise<void> } {
    if (!this.journalKey)
      return (
        this.journal()?.track(tool, run, turn, isCurrent) ?? {
          app: this.app,
          close: async () => {},
        }
      )
    const tracker = ChangeTracker.get(this.app)
    const chat = this.host.key()
    if (!tracker || rewindLimitBytes() === 0 || !chat || !turn)
      return { app: this.app, close: async () => {} }
    const scope = tracker.scope({
      record: (op, changes, blobs) => {
        if (!isCurrent()) return
        this.record(op, changes, blobs, { chat, run, turn, tool })
        void this.flush()
      },
    })
    // A script may suspend on a form and keep this facade. Later writes retain their origin.
    return { app: scope.app, close: () => this.flush() }
  }

  /** A standalone invocation. Only mutations through the returned app are attributed to it. */
  begin(tool: string): (() => Promise<void>) & { app: App } {
    const scope = this.track(tool, ChangeTracker.entryId())
    return Object.assign(scope.close, { app: scope.app })
  }

  record(
    op: string,
    changes: Change[],
    blobs: Map<string, ArrayBuffer>,
    owner?: { chat: string; run: string; turn: string; tool: string }
  ): void {
    if (!this.journalKey) {
      this.journal(owner?.chat ?? this.host.key())?.record(op, changes, blobs, owner)
      return
    }
    const turn = owner?.turn ?? this.host.turn()
    if (!turn) return
    for (const change of changes) {
      const before = change.before
      if (before.t === 'binary' && before.blob) {
        const data = blobs.get(before.blob)
        if (data) this.pendingBlobs.set(before.blob, data)
      }
    }
    const entry: RewindEntry = {
      id: ChangeTracker.entryId(),
      turn,
      at: Date.now(),
      chat: this.host.key() ?? undefined,
      run: turn,
      ...(owner ?? {}),
      op,
      changes,
    }
    this.entries.value = [...this.entries.value, entry]
    this.dirty = true
  }

  /** Reads the chat's log. Called when the chat is opened; safe to call again. */
  load(): Promise<void> {
    if (!this.journalKey) return this.journal()?.load() ?? Promise.resolve()
    const key = this.host.key()
    if (!key || key === this.loadedKey) return this.loading ?? Promise.resolve()
    this.loadedKey = key
    this.loading = (async () => {
      const log: RewindLogFile | null = await this.store.readLog(key).catch((): null => null)
      if (!log) return
      // Anything recorded while the file was being read comes after what it held.
      const known = new Set(log.entries.map((e: RewindEntry) => e.id))
      this.entries.value = [...log.entries, ...this.entries.value.filter((e) => !known.has(e.id))]
    })()
    return this.loading
  }

  /** Writes the log and the copies it needs, then keeps the whole store under its cap. */
  flush(): Promise<void> {
    if (!this.journalKey)
      return Promise.all([...this.journals.values()].map((journal) => journal.flush())).then(
        () => {}
      )
    this.writing = this.writing
      .then(() => this.writeNow())
      .catch((err) => {
        console.warn('[Abele] Rewind log not written', err)
        if (!this.failureNotified) {
          this.failureNotified = true
          new Notice(t('streamB.abeleCouldNotSaveAnUndoSnapshot.96b58f'))
        }
      })
    return this.writing
  }

  private async writeNow(): Promise<void> {
    if (!this.dirty) return
    const key = this.host.key()
    if (!key) return
    if (this.loadedKey !== key) await this.load()
    else await this.loading
    const entries = this.entries.value
    const blobs = [...this.pendingBlobs]
    for (const [name, data] of blobs) await this.store.writeBlob(key, name, data)
    await this.store.writeLog(key, { version: 1, entries })
    // Keep everything retryable until both the copies and their index are durable. Changes
    // recorded during IO belong to the next write and must not have their dirty flag cleared.
    this.dirty = this.entries.value !== entries
    for (const [name, data] of blobs) {
      if (this.pendingBlobs.get(name) === data) this.pendingBlobs.delete(name)
    }
    this.failureNotified = false
    await this.prune(key)
  }

  /** Drops whole chats, least recently written first, then this chat's oldest entries. */
  private async prune(key: string): Promise<void> {
    const limit = rewindLimitBytes()
    if (limit === 0) return
    const usage = await this.store.usage()
    let total = usage.reduce((sum, u) => sum + u.bytes, 0)
    if (total <= limit) return
    for (const other of usage.filter((u) => u.key !== key).sort((a, b) => a.touched - b.touched)) {
      await this.store.drop(other.key)
      total -= other.bytes
      if (total <= limit) return
    }
    const mine = usage.find((u) => u.key === key)?.bytes ?? 0
    let over = total - limit
    const entries = [...this.entries.value]
    const dropped: RewindEntry[] = []
    while (over > 0 && entries.length > 1) {
      const entry = entries.shift() as RewindEntry
      dropped.push(entry)
      over -= entrySize(entry)
    }
    if (!dropped.length || mine === 0) return
    await this.replace(key, entries, dropped)
  }

  /** Keeps `entries`, and removes the copies only `dropped` used. */
  private async replace(key: string, entries: RewindEntry[], dropped: RewindEntry[]) {
    this.entries.value = entries
    await this.store.writeLog(key, { version: 1, entries })
    const used = new Set(entries.flatMap(blobNames))
    for (const name of new Set(dropped.flatMap(blobNames))) {
      if (!used.has(name)) await this.store.removeBlob(key, name)
    }
  }

  /** User messages whose turns changed something still in the log. */
  turnsWithChanges(): Set<string> {
    return new Set(this.entries.value.map((e) => e.turn))
  }

  /** Every change since `since` (a message's time), whichever turn made it. */
  planSince(since: number): Promise<RestorePlan> {
    return this.plan((e) => e.at >= since)
  }

  /** The changes one turn made. */
  planTurn(turn: string): Promise<RestorePlan> {
    return this.plan((e) => e.turn === turn)
  }

  private async plan(select: (e: RewindEntry) => boolean): Promise<RestorePlan> {
    if (!this.journalKey)
      return this.journal()?.plan(select) ?? { items: [], entryIds: [], settled: [], units: [] }
    await this.load()
    return planRestore(
      this.entries.value.filter((e) => (!e.chat || e.chat === this.host.key()) && select(e)),
      new VaultFs(this.app)
    )
  }

  /** Puts the files back; what was restored leaves the log, what was skipped stays. */
  async apply(
    plan: RestorePlan,
    choices: Record<string, ConflictChoice> = {}
  ): Promise<RestoreResult> {
    if (!this.journalKey) {
      const journal = this.journal()
      if (!journal) throw new UiError(uiMessage('streamBError.8d7c0dc93d'))
      return journal.apply(plan, choices)
    }
    await this.load()
    const key = this.host.key()
    const available = new Set(
      this.entries.value
        .filter((entry) => !entry.chat || entry.chat === key)
        .flatMap((entry) => entry.changes.map((_, index) => `${entry.id}:${index}`))
    )
    if (
      [
        ...plan.settled,
        ...plan.items.flatMap((item) => item.refs),
        ...(plan.units?.flatMap((unit) => unit.refs) ?? []),
      ].some((ref) => !available.has(ref))
    )
      throw new UiError(uiMessage('streamBError.8d7c0dc93d'))
    const owned = new Set(
      this.entries.value
        .filter((entry) => entry.chat === key)
        .flatMap((entry) => entry.changes.map((_, index) => `${entry.id}:${index}`))
    )
    // Matching bytes in an old broadcast journal are not evidence of who wrote them.
    const safePlan: RestorePlan = {
      ...plan,
      settled: plan.settled.filter((ref) => owned.has(ref)),
      items: plan.items.map((item) =>
        item.refs.every((ref) => owned.has(ref))
          ? item
          : { ...item, conflict: true, reason: UNOWNED_RECORDING }
      ),
      units: plan.units?.map((unit) =>
        unit.refs.every((ref) => owned.has(ref)) ? unit : { ...unit, refused: UNOWNED_RECORDING }
      ),
    }
    const tracker = ChangeTracker.get(this.app)
    const fs = new VaultFs(this.app, tracker?.checkedApp.bind(tracker))
    const blob = (name: string) => (key ? this.store.readBlob(key, name) : Promise.resolve(null))
    const run = () => applyRestore(safePlan, choices, fs, blob)
    const outcome = await run()

    const done = new Set(outcome.refs)
    const kept: RewindEntry[] = []
    const dropped: RewindEntry[] = []
    for (const entry of this.entries.value) {
      const left = entry.changes.filter((_, i) => !done.has(`${entry.id}:${i}`))
      if (left.length === entry.changes.length) kept.push(entry)
      else {
        dropped.push(entry)
        if (left.length) kept.push({ ...entry, changes: left })
      }
    }
    if (key && dropped.length) await this.replace(key, kept, dropped)
    const { restored, skipped, failed } = outcome
    return { restored, skipped, failed }
  }
}

function blobNames(entry: RewindEntry): string[] {
  return entry.changes.flatMap((c) =>
    c.before.t === 'binary' && c.before.blob ? [c.before.blob] : []
  )
}

function entrySize(entry: RewindEntry): number {
  let size = 200
  for (const c of entry.changes) {
    size += c.path.length + 100
    if (c.before.t === 'text') size += c.before.text.length
    if (c.before.t === 'binary' && c.before.blob) size += c.before.size
  }
  return size
}

export type { RewindLogFile }
