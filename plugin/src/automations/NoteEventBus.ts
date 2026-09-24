import { TFile, type App, type EventRef, type TAbstractFile } from 'obsidian'
import { bodyOf, changedKeys, fingerprint, kindsFor } from './diff'
import type { ChangeOrigin, Frontmatter, NoteChange } from './types'

/**
 * The one place automations hear about notes.
 *
 * Built on the metadata cache, like `TasksList` and the finance lists — a note's `type`, which
 * decides whether it is a task at all, exists only once the cache has parsed it. What those
 * lists do not keep is the frontmatter a note had *before* a change, and an automation needs
 * exactly that to tell a task being completed from a task being edited. So this keeps a copy
 * of every note's frontmatter while it runs, and runs only while some automation is switched
 * on: a vault without automations pays nothing for it.
 */

export type OriginOf = (path: string) => { origin: ChangeOrigin; chain: string[] }

export interface BusTiming {
  /** A new note is announced once it has gone this long without changing again… */
  settleMs: number
  /** …or this long after it appeared, whichever comes first. */
  maxSettleMs: number
}

interface Snapshot {
  frontmatter: Frontmatter
  /** Of the body, once seen. Unknown for a note not changed since the bus started. */
  body: string | null
}

interface PendingCreate {
  origin: ReturnType<OriginOf>
  firstAt: number
  timer: number
}

type Listener = (change: NoteChange) => void

const isNote = (file: TAbstractFile | null | undefined): file is TFile =>
  file instanceof TFile && file.extension === 'md'

/** A copy that no later parse can reach into. */
const copy = (fm: unknown): Frontmatter =>
  fm && typeof fm === 'object' ? (JSON.parse(JSON.stringify(fm)) as Frontmatter) : {}

export class NoteEventBus {
  private snapshots = new Map<string, Snapshot>()
  private pending = new Map<string, PendingCreate>()
  private listeners = new Set<Listener>()
  private refs: { source: 'vault' | 'metadataCache'; ref: EventRef }[] = []
  private running = false

  constructor(
    private readonly app: App,
    private readonly originOf: OriginOf,
    private readonly timing: BusTiming = { settleMs: 1000, maxSettleMs: 5000 }
  ) {}

  get isRunning(): boolean {
    return this.running
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.running) return
    this.running = true

    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter
      this.snapshots.set(file.path, { frontmatter: copy(fm), body: null })
    }

    const { vault, metadataCache } = this.app
    this.refs.push(
      {
        source: 'metadataCache',
        ref: metadataCache.on('changed', (file: TFile, data: string) => this.onChanged(file, data)),
      },
      { source: 'vault', ref: vault.on('create', (file) => this.onCreate(file)) },
      { source: 'vault', ref: vault.on('rename', (file, old) => this.onRename(file, old)) },
      { source: 'vault', ref: vault.on('delete', (file) => this.onDelete(file)) }
    )
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    for (const { source, ref } of this.refs) this.app[source].offref(ref)
    this.refs = []
    for (const pending of this.pending.values()) window.clearTimeout(pending.timer)
    this.pending.clear()
    this.snapshots.clear()
  }

  private emit(change: NoteChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change)
      } catch (err) {
        console.error('[Abele] automation listener failed', err)
      }
    }
  }

  private frontmatterOf(file: TFile): Frontmatter {
    return copy(this.app.metadataCache.getFileCache(file)?.frontmatter)
  }

  private onChanged(file: TFile, data: string): void {
    if (!isNote(file)) return

    // Still settling: the change is part of it being made, not a change to a made note.
    const pending = this.pending.get(file.path)
    if (pending) {
      this.schedule(file.path, pending)
      return
    }

    const previous = this.snapshots.get(file.path)
    const after = this.frontmatterOf(file)
    const body = typeof data === 'string' ? fingerprint(bodyOf(data)) : null
    this.snapshots.set(file.path, { frontmatter: after, body })
    // A note the bus never saw — made while it was stopping, say — has nothing to compare to.
    if (!previous) return

    const changed = changedKeys(previous.frontmatter, after)
    // A body not seen before: `changed` fires on a write, so if the frontmatter is the same
    // the text must be what moved.
    const bodyChanged =
      previous.body !== null && body !== null ? previous.body !== body : changed.length === 0
    if (!changed.length && !bodyChanged) return

    const { origin, chain } = this.originOf(file.path)
    this.emit({
      kinds: kindsFor({ before: previous.frontmatter, after }),
      path: file.path,
      type: typeText(after.type),
      before: previous.frontmatter,
      after,
      changed,
      bodyChanged,
      origin,
      chain,
      at: Date.now(),
    })
  }

  private onCreate(file: TAbstractFile): void {
    if (!isNote(file)) return
    const pending: PendingCreate = {
      origin: this.originOf(file.path),
      firstAt: Date.now(),
      timer: 0,
    }
    this.pending.set(file.path, pending)
    this.schedule(file.path, pending)
  }

  private schedule(path: string, pending: PendingCreate): void {
    window.clearTimeout(pending.timer)
    const left = pending.firstAt + this.timing.maxSettleMs - Date.now()
    const wait = Math.max(0, Math.min(this.timing.settleMs, left))
    pending.timer = window.setTimeout(() => this.settle(path), wait)
  }

  private settle(path: string): void {
    const pending = this.pending.get(path)
    if (!pending) return
    this.pending.delete(path)

    const file = this.app.vault.getAbstractFileByPath(path)
    if (!isNote(file)) return

    const after = this.frontmatterOf(file)
    this.snapshots.set(path, { frontmatter: after, body: null })
    this.emit({
      kinds: kindsFor({ created: true, before: null, after }),
      path,
      type: typeText(after.type),
      before: null,
      after,
      changed: Object.keys(after),
      bodyChanged: false,
      origin: pending.origin.origin,
      chain: pending.origin.chain,
      at: Date.now(),
    })
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    if (!isNote(file) && !oldPath.endsWith('.md')) return

    const pending = this.pending.get(oldPath)
    if (pending) {
      this.pending.delete(oldPath)
      this.pending.set(file.path, pending)
      window.clearTimeout(pending.timer)
      this.schedule(file.path, pending)
      return
    }

    const snapshot = this.snapshots.get(oldPath)
    this.snapshots.delete(oldPath)
    // Renamed to something that is no longer a note: to automations it is gone.
    if (!isNote(file)) return
    const frontmatter = snapshot?.frontmatter ?? this.frontmatterOf(file)
    this.snapshots.set(file.path, { frontmatter, body: snapshot?.body ?? null })

    const { origin, chain } = this.originOf(file.path)
    this.emit({
      kinds: kindsFor({ renamed: true, before: frontmatter, after: frontmatter }),
      path: file.path,
      oldPath,
      type: typeText(frontmatter.type),
      before: frontmatter,
      after: frontmatter,
      changed: [],
      bodyChanged: false,
      origin,
      chain,
      at: Date.now(),
    })
  }

  private onDelete(file: TAbstractFile): void {
    if (!isNote(file)) return

    const pending = this.pending.get(file.path)
    if (pending) {
      window.clearTimeout(pending.timer)
      this.pending.delete(file.path)
      this.snapshots.delete(file.path)
      return
    }

    const snapshot = this.snapshots.get(file.path)
    this.snapshots.delete(file.path)
    const before = snapshot?.frontmatter ?? {}

    const { origin, chain } = this.originOf(file.path)
    this.emit({
      kinds: kindsFor({ deleted: true, before, after: null }),
      path: file.path,
      type: typeText(before.type),
      before,
      after: null,
      changed: [],
      bodyChanged: false,
      origin,
      chain,
      at: Date.now(),
    })
  }
}

function typeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}
