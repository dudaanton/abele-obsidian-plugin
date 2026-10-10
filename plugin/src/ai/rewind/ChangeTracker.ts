/**
 * Invocation-owned file facades over the vault, adapter and file manager. A chat receives only
 * mutations issued through its facade, including native link updates. No async ambient owner
 * is installed, so concurrent chats and human edits cannot borrow each other's identity.
 * Nested layers share one tracker and suppress duplicate snapshots of the same path. The
 * root observes unowned mutations only to invalidate overlapping snapshots; it does not send
 * them to a chat. Configuration, trash and chat files are never recorded.
 */
import type { App, TAbstractFile } from 'obsidian'
import { guardTrashRevision, registerRevisionTrash } from '@/services/revisionTrash'
import { nanoid } from 'nanoid'
import { contentHash } from '../readGuard'
import { VaultFs, bytesHash, isTextPath } from './vaultFs'
import type { After, Before, Change } from './types'
import { checkedMutation } from './checkedMutation'

/** Where an operation's changes go: a chat's log, which also keeps the copies of binaries. */
export interface Recording {
  record(op: string, changes: Change[], blobs: Map<string, ArrayBuffer>): void
}

/** Opportunistic binary snapshots above this are not copied; explicit prepared writes retain theirs. */
export const MAX_BLOB_BYTES = 20 * 1024 * 1024

interface Spec {
  /** Paths the operation writes, creates or removes. */
  paths: string[]
  /** A move, whose source is kept by where it went rather than by a copy. */
  move?: { from: string; to: string }
  /** Removes whatever is at these paths: a folder's files are captured with it. */
  removes?: boolean
}

interface PreparedBinary {
  path: string
  before: Before
  blobs: Map<string, ArrayBuffer>
  didWrite: () => boolean
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
  private static readonly scopes = new WeakMap<App, ChangeTracker>()
  private static readonly originals = new WeakMap<AnyFn, AnyFn>()
  private active: { paths: string[]; uncertain: boolean }[] = []
  private ownerRoot: ChangeTracker = this
  private checks: Map<string, After> | null = null
  private emptyFolders = new Set<string>()

  checkedApp(expected: Map<string, After>, emptyFolders = new Set<string>()): App {
    const scope = this.scope({ record: () => {} })
    const tracker = ChangeTracker.scopes.get(scope.app)!
    tracker.recordings.clear()
    tracker.checks = expected
    tracker.emptyFolders = emptyFolders
    return scope.app
  }

  /** An invocation owns its file facade; no ambient async "current chat" is involved. */
  scope(recording: Recording): { app: App; close: () => void } {
    const app = Object.create(this.app) as App
    const tracker = new ChangeTracker(this.app)
    tracker.ownerRoot = this.ownerRoot
    const layer = (
      source: object,
      ops: Record<string, (args: unknown[]) => Spec>,
      name: string
    ) => {
      const facade = Object.create(source) as Record<string, unknown>
      // Non-writing methods stay bound to the real host (including native private state).
      tracker.wrap(facade, ops, name)
      return facade
    }
    app.vault = layer(this.app.vault, VAULT_OPS, 'vault') as unknown as App['vault']
    app.vault.adapter = layer(
      this.app.vault.adapter,
      ADAPTER_OPS,
      'adapter'
    ) as unknown as App['vault']['adapter']
    app.fileManager = layer(
      this.app.fileManager,
      FILE_MANAGER_OPS,
      'fileManager'
    ) as unknown as App['fileManager']
    const bindHost = (target: object) =>
      Object.defineProperties(Object.create(target), {
        app: { value: app },
        vault: { value: app.vault },
      })
    Object.defineProperties(app.fileManager, {
      app: { value: app },
      vault: { value: app.vault },
    })
    // Native rename rewrites links through MetadataCache, not FileManager's vault field.
    // Keep its shared indexes, but route those writes (including Canvas links) through the owner.
    app.metadataCache = bindHost(this.app.metadataCache)
    const cache = this.app.metadataCache as unknown as { linkUpdaters?: Record<string, object> }
    if (cache.linkUpdaters)
      Object.defineProperty(app.metadataCache, 'linkUpdaters', {
        value: Object.fromEntries(
          Object.entries(cache.linkUpdaters).map(([key, updater]) => [key, bindHost(updater)])
        ),
      })
    ChangeTracker.scopes.set(app, tracker)
    const close = tracker.open(recording)
    return { app, close }
  }

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
    tracker.restores.push(registerRevisionTrash(app.vault.adapter))
    ChangeTracker.instance = tracker
    return tracker
  }

  static get(app?: App): ChangeTracker | null {
    return (
      (app && ChangeTracker.scopes.get(app)) ??
      (app && ChangeTracker.instance?.app !== app ? null : ChangeTracker.instance)
    )
  }

  /** Keep an edit's original bytes before its final check, without another snapshot read later. */
  prepareBinaryWrite(
    path: string,
    data: Uint8Array,
    didWrite: () => boolean
  ): <T>(run: () => Promise<T>) => Promise<T> {
    if (this.muted > 0 || !this.recordings.size || this.excluded(path)) return (run) => run()
    const copy = data.slice().buffer as ArrayBuffer
    const hash = bytesHash(copy)
    const prepared: PreparedBinary = {
      path,
      before: { t: 'binary', hash, size: copy.byteLength, blob: hash },
      blobs: new Map([[hash, copy]]),
      didWrite,
    }
    // Explicitly prepared edits retain their snapshot even above the generic opportunistic cap.
    return (run) => this.around('vault.modifyBinary', { paths: [path] }, run, prepared)
  }

  /**
   * A create-only operation has a known-missing before-state: never snapshot a collision.
   * Validate inside the prepared operation, after tracker preparation and immediately before
   * issuance. The public vault call is nested/suppressed normally; the invocation's recording
   * receives successful changes. Validation also runs while tracking is inactive or muted.
   */
  prepareCreate(
    path: string,
    kind: 'binary' | 'folder',
    validate: () => void
  ): <T>(run: () => Promise<T>) => Promise<T> {
    const prepared: PreparedBinary = {
      path,
      before: { t: 'missing' },
      blobs: new Map(),
      didWrite: () => false,
    }
    return (run) =>
      this.around(
        kind === 'binary' ? 'vault.createBinary' : 'vault.createFolder',
        { paths: [path] },
        () => {
          validate()
          return run()
        },
        prepared
      )
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
      const raw = ChangeTracker.originals.get(original as AnyFn) ?? (original as AnyFn)
      const bound = raw.bind(target)
      const wrapped = (...args: unknown[]) =>
        this.around(`${layer}.${name}`, spec(args), () => {
          const mutate = () => Promise.resolve(bound(...args))
          if (layer === 'adapter' && this.checks) {
            const operation = spec(args)
            return checkedMutation(
              this.app.vault.adapter,
              this.checks,
              [
                ...operation.paths,
                ...(operation.move ? [operation.move.from, operation.move.to] : []),
              ],
              this.emptyFolders,
              mutate
            )
          }
          return layer === 'adapter' && (name === 'trashLocal' || name === 'trashSystem')
            ? guardTrashRevision(target, pathOf(args[0]), mutate)
            : mutate()
        })
      ChangeTracker.originals.set(wrapped, raw)
      target[name] = wrapped
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

  private async around<T>(
    op: string,
    spec: Spec,
    run: () => Promise<T>,
    prepared?: PreparedBinary
  ): Promise<T> {
    const touched = [...spec.paths, ...(spec.move ? [spec.move.from, spec.move.to] : [])]
    const overlaps = (a: string, b: string) =>
      a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
    const others = this.ownerRoot.active.filter((active) =>
      active.paths.some((a) => touched.some((b) => overlaps(a, b)))
    )
    if (this.muted > 0 || this.recordings.size === 0) {
      for (const other of others) other.uncertain = true
      return run()
    }

    const move = spec.move && !this.excluded(spec.move.from) ? spec.move : undefined
    const direct = spec.paths.filter((p) => !this.excluded(p))
    const mine = [...direct, ...(move ? [move.from, move.to] : [])].filter(
      (p) => !this.inFlight.has(p)
    )
    if (!mine.length) return run()

    const recordings = [...this.recordings.keys()]
    for (const other of others) other.uncertain = true
    const active = { paths: mine, uncertain: others.length > 0 }
    this.ownerRoot.active.push(active)
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
          if (prepared?.path === path) {
            befores.set(path, prepared.before)
            for (const [hash, data] of prepared.blobs) blobs.set(hash, data)
          } else befores.set(path, await this.capture(path, blobs))
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

      let completed = false
      try {
        const result = await run()
        completed = true
        return result
      } finally {
        // A post-write conflict must still leave the original bytes available for rewind.
        if (completed || prepared?.didWrite()) {
          const changes: Change[] = []
          for (const [path, before] of befores) {
            const after = await this.fingerprint(path).catch((): After => null)
            if (after !== afterOf(before))
              changes.push({
                path,
                before,
                after,
                ...(active.uncertain || !completed ? { uncertain: true } : {}),
              })
          }
          if (changes.length)
            for (const recording of recordings) recording.record(op, changes, blobs)
        }
      }
    } finally {
      this.ownerRoot.active = this.ownerRoot.active.filter((item) => item !== active)
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
