/**
 * Hears every change made to the vault while an agent's tool is running, and remembers what
 * each file was before it.
 *
 * Tools write in a dozen ways — the file tools through the vault, frontmatter through the file
 * manager, the reader's bookmarks and places straight through the adapter, a script through
 * whatever it likes — and a list of them kept by hand would be out of date with the next tool.
 * So the tracker sits under all of them: it wraps the running app's `vault`, its `adapter` and
 * its `fileManager`, and while a recording is open every call that changes something is
 * recorded into it, whoever made it.
 *
 * The layers call each other: renaming through the file manager renames through the vault,
 * which renames through the adapter. A path already being changed by an outer call is left to
 * that call, so one operation is one entry. Other paths an operation changes on the way — the
 * links Obsidian rewrites in other notes after a rename — are entries of their own.
 *
 * Nothing is recorded while no recording is open, and nothing ever for the config folder, the
 * trash, or chat files. What cannot be told apart is a change the person makes by hand while a
 * tool is running: it is recorded as the agent's, and a rewind shows it among the rest.
 */
import type { App, TAbstractFile } from 'obsidian'
import { nanoid } from 'nanoid'
import { contentHash } from '../readGuard'
import { VaultFs, bytesHash, isTextPath } from './vaultFs'
import type { After, Before, Change } from './types'

/** Where an operation's changes go: a chat's log, which also keeps the copies of binaries. */
export interface Recording {
  record(op: string, changes: Change[], blobs: Map<string, ArrayBuffer>): void
}

/** Binaries larger than this are not copied; they come back only by being moved back. */
export const MAX_BLOB_BYTES = 20 * 1024 * 1024

interface Spec {
  /** Paths the operation writes, creates or removes. */
  paths: string[]
  /** A move, whose source is kept by where it went rather than by a copy. */
  move?: { from: string; to: string }
  /** Removes whatever is at these paths: a folder's files are captured with it. */
  removes?: boolean
}

type AnyFn = (...args: unknown[]) => unknown

const pathOf = (file: unknown): string =>
  typeof file === 'string' ? file : ((file as TAbstractFile | null)?.path ?? '')

const VAULT_OPS: Record<string, (args: unknown[]) => Spec> = {
  create: (a) => ({ paths: [pathOf(a[0])] }),
  createBinary: (a) => ({ paths: [pathOf(a[0])] }),
  createFolder: (a) => ({ paths: [pathOf(a[0])] }),
  modify: (a) => ({ paths: [pathOf(a[0])] }),
  modifyBinary: (a) => ({ paths: [pathOf(a[0])] }),
  append: (a) => ({ paths: [pathOf(a[0])] }),
  process: (a) => ({ paths: [pathOf(a[0])] }),
  delete: (a) => ({ paths: [pathOf(a[0])], removes: true }),
  trash: (a) => ({ paths: [pathOf(a[0])], removes: true }),
  rename: (a) => ({ paths: [], move: { from: pathOf(a[0]), to: pathOf(a[1]) } }),
  copy: (a) => ({ paths: [pathOf(a[1])] }),
}

const ADAPTER_OPS: Record<string, (args: unknown[]) => Spec> = {
  write: (a) => ({ paths: [pathOf(a[0])] }),
  writeBinary: (a) => ({ paths: [pathOf(a[0])] }),
  append: (a) => ({ paths: [pathOf(a[0])] }),
  process: (a) => ({ paths: [pathOf(a[0])] }),
  mkdir: (a) => ({ paths: [pathOf(a[0])] }),
  remove: (a) => ({ paths: [pathOf(a[0])], removes: true }),
  rmdir: (a) => ({ paths: [pathOf(a[0])], removes: true }),
  trashSystem: (a) => ({ paths: [pathOf(a[0])], removes: true }),
  trashLocal: (a) => ({ paths: [pathOf(a[0])], removes: true }),
  rename: (a) => ({ paths: [], move: { from: pathOf(a[0]), to: pathOf(a[1]) } }),
  copy: (a) => ({ paths: [pathOf(a[1])] }),
}

const FILE_MANAGER_OPS: Record<string, (args: unknown[]) => Spec> = {
  renameFile: (a) => ({ paths: [], move: { from: pathOf(a[0]), to: pathOf(a[1]) } }),
  trashFile: (a) => ({ paths: [pathOf(a[0])], removes: true }),
  processFrontMatter: (a) => ({ paths: [pathOf(a[0])] }),
}

const afterOf = (before: Before): After =>
  before.t === 'missing' ? null : before.t === 'folder' ? 'folder' : before.hash

export class ChangeTracker {
  private static instance: ChangeTracker | null = null

  private readonly fs: VaultFs
  private readonly recordings = new Map<Recording, number>()
  private readonly inFlight = new Map<string, number>()
  private readonly restores: (() => void)[] = []
  private muted = 0

  private constructor(private readonly app: App) {
    this.fs = new VaultFs(app)
  }

  /** Wraps the app's file layers. Once per app; a second call returns the first tracker. */
  static install(app: App): ChangeTracker {
    if (ChangeTracker.instance?.app === app) return ChangeTracker.instance
    ChangeTracker.instance?.uninstall()
    const tracker = new ChangeTracker(app)
    tracker.wrap(app.vault as unknown as Record<string, unknown>, VAULT_OPS, 'vault')
    tracker.wrap(app.vault.adapter as unknown as Record<string, unknown>, ADAPTER_OPS, 'adapter')
    tracker.wrap(
      app.fileManager as unknown as Record<string, unknown>,
      FILE_MANAGER_OPS,
      'fileManager'
    )
    ChangeTracker.instance = tracker
    return tracker
  }

  static get(): ChangeTracker | null {
    return ChangeTracker.instance
  }

  /** Puts every wrapped method back as it was. */
  uninstall(): void {
    for (const restore of this.restores.splice(0).reverse()) restore()
    if (ChangeTracker.instance === this) ChangeTracker.instance = null
  }

  /** Starts sending changes to `recording`; the function returned stops it. */
  open(recording: Recording): () => void {
    this.recordings.set(recording, (this.recordings.get(recording) ?? 0) + 1)
    let closed = false
    return () => {
      if (closed) return
      closed = true
      const left = (this.recordings.get(recording) ?? 1) - 1
      if (left > 0) this.recordings.set(recording, left)
      else this.recordings.delete(recording)
    }
  }

  /** Runs `fn` with nothing recorded — a restore's own writes are not the agent's. */
  async mute<T>(fn: () => Promise<T>): Promise<T> {
    this.muted++
    try {
      return await fn()
    } finally {
      this.muted--
    }
  }

  private wrap(
    target: Record<string, unknown> | undefined,
    ops: Record<string, (args: unknown[]) => Spec>,
    layer: string
  ): void {
    if (!target) return
    for (const [name, spec] of Object.entries(ops)) {
      const original = target[name]
      if (typeof original !== 'function') continue
      const own = Object.prototype.hasOwnProperty.call(target, name)
      const bound = (original as AnyFn).bind(target)
      target[name] = (...args: unknown[]) =>
        this.around(`${layer}.${name}`, spec(args), () => Promise.resolve(bound(...args)))
      this.restores.push(() => {
        if (own) target[name] = original
        else delete target[name]
      })
    }
  }

  private excluded(path: string): boolean {
    if (!path) return true
    const config = this.app.vault.configDir
    return (
      path === config ||
      path.startsWith(`${config}/`) ||
      path === '.trash' ||
      path.startsWith('.trash/') ||
      path.endsWith('.abchat')
    )
  }

  private async around<T>(op: string, spec: Spec, run: () => Promise<T>): Promise<T> {
    if (this.muted > 0 || this.recordings.size === 0) return run()

    const move = spec.move && !this.excluded(spec.move.from) ? spec.move : undefined
    const direct = spec.paths.filter((p) => !this.excluded(p))
    const mine = [...direct, ...(move ? [move.from, move.to] : [])].filter(
      (p) => !this.inFlight.has(p)
    )
    if (!mine.length) return run()

    const recordings = [...this.recordings.keys()]
    for (const p of mine) this.inFlight.set(p, (this.inFlight.get(p) ?? 0) + 1)
    try {
      const blobs = new Map<string, ArrayBuffer>()
      const befores = new Map<string, Before>()
      try {
        if (move && mine.includes(move.from)) {
          befores.set(move.from, await this.capture(move.from, blobs, move.to))
        }
        if (move && mine.includes(move.to)) befores.set(move.to, await this.capture(move.to, blobs))
        for (const path of direct) {
          if (!mine.includes(path)) continue
          befores.set(path, await this.capture(path, blobs))
          if (spec.removes && (await this.fs.kind(path)) === 'folder') {
            for (const inner of await this.fs.filesUnder(path)) {
              if (!this.excluded(inner) && !befores.has(inner)) {
                befores.set(inner, await this.capture(inner, blobs))
              }
            }
          }
        }
      } catch (err) {
        // Recording must never stop the write it is watching.
        console.warn('[Abele] Rewind could not read a file before it changed', err)
        return run()
      }

      const result = await run()

      const changes: Change[] = []
      for (const [path, before] of befores) {
        const after = await this.fingerprint(path).catch((): After => null)
        if (after !== afterOf(before)) changes.push({ path, before, after })
      }
      if (changes.length) {
        for (const recording of recordings) recording.record(op, changes, blobs)
      }
      return result
    } finally {
      for (const p of mine) {
        const left = (this.inFlight.get(p) ?? 1) - 1
        if (left > 0) this.inFlight.set(p, left)
        else this.inFlight.delete(p)
      }
    }
  }

  /** The path as it is, kept well enough to be put back. */
  private async capture(
    path: string,
    blobs: Map<string, ArrayBuffer>,
    movedTo?: string
  ): Promise<Before> {
    const kind = await this.fs.kind(path)
    if (kind === null) return { t: 'missing' }
    if (kind === 'folder') return movedTo ? { t: 'folder', movedTo } : { t: 'folder' }
    if (isTextPath(path)) {
      const text = await this.fs.readText(path)
      return { t: 'text', hash: contentHash(text), text, ...(movedTo ? { movedTo } : {}) }
    }
    const data = await this.fs.readBinary(path)
    const hash = bytesHash(data)
    // A binary that is only moved comes back by moving it back; no copy is needed for that.
    const keep = !movedTo && data.byteLength <= MAX_BLOB_BYTES
    if (keep) blobs.set(hash, data)
    return {
      t: 'binary',
      hash,
      size: data.byteLength,
      ...(keep ? { blob: hash } : {}),
      ...(movedTo ? { movedTo } : {}),
    }
  }

  private async fingerprint(path: string): Promise<After> {
    const kind = await this.fs.kind(path)
    if (kind === null) return null
    if (kind === 'folder') return 'folder'
    if (isTextPath(path)) return contentHash(await this.fs.readText(path))
    return bytesHash(await this.fs.readBinary(path))
  }

  /** A fresh id for an entry. */
  static entryId(): string {
    return nanoid(10)
  }
}
