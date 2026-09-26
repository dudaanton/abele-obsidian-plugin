/**
 * One chat's rewind log: what its agent changed in the vault, turn by turn, and the way back.
 *
 * The chat opens a recording around every tool call it makes; the tracker sends into it every
 * change made meanwhile, which lands here as an entry under the user message whose turn it
 * was. The log is written after each call that changed something, in the plugin's folder on
 * this device (see `RewindStore`), and kept under the size the settings allow — the chats
 * written to least recently go first.
 */
import { shallowRef } from 'vue'
import type { App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ChangeTracker, type Recording } from './ChangeTracker'
import { adapterStore, type RewindStore } from './RewindStore'
import { VaultFs } from './vaultFs'
import { applyRestore, planRestore } from './restore'
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
  readonly entries = shallowRef<RewindEntry[]>([])

  private loadedKey: string | null = null
  private loading: Promise<void> | null = null
  private pendingBlobs = new Map<string, ArrayBuffer>()
  private currentTool: string | undefined
  private dirty = false
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly app: App,
    private readonly host: RewindHost,
    private readonly store: RewindStore = adapterStore(app)
  ) {}

  /** Starts recording for one tool call; the function returned stops it and writes the log. */
  begin(tool: string): () => Promise<void> {
    const tracker = ChangeTracker.get()
    if (!tracker || rewindLimitBytes() === 0 || !this.host.key()) return async () => {}
    const close = tracker.open(this)
    const previous = this.currentTool
    this.currentTool = tool
    return async () => {
      close()
      this.currentTool = previous
      await this.flush()
    }
  }

  record(op: string, changes: Change[], blobs: Map<string, ArrayBuffer>): void {
    const turn = this.host.turn()
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
      ...(this.currentTool ? { tool: this.currentTool } : {}),
      op,
      changes,
    }
    this.entries.value = [...this.entries.value, entry]
    this.dirty = true
  }

  /** Reads the chat's log. Called when the chat is opened; safe to call again. */
  load(): Promise<void> {
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
    this.writing = this.writing
      .then(() => this.writeNow())
      .catch((err) => {
        console.warn('[Abele] Rewind log not written', err)
      })
    return this.writing
  }

  private async writeNow(): Promise<void> {
    if (!this.dirty) return
    const key = this.host.key()
    if (!key) return
    if (this.loadedKey !== key) await this.load()
    else await this.loading
    this.dirty = false
    const blobs = [...this.pendingBlobs]
    this.pendingBlobs.clear()
    for (const [name, data] of blobs) await this.store.writeBlob(key, name, data)
    await this.store.writeLog(key, { version: 1, entries: this.entries.value })
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
    await this.load()
    return planRestore(this.entries.value.filter(select), new VaultFs(this.app))
  }

  /** Puts the files back; what was restored leaves the log, what was skipped stays. */
  async apply(plan: RestorePlan, choices: Record<string, ConflictChoice>): Promise<RestoreResult> {
    const key = this.host.key()
    const fs = new VaultFs(this.app)
    const blob = (name: string) => (key ? this.store.readBlob(key, name) : Promise.resolve(null))
    const run = () => applyRestore(plan, choices, fs, blob)
    const tracker = ChangeTracker.get()
    const outcome = tracker ? await tracker.mute(run) : await run()

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
