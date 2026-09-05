import { normalizePath, TFolder } from 'obsidian'
import type { App, DataAdapter, EventRef, ListedFiles, Stat, TAbstractFile } from 'obsidian'
import { EngineError, type FileInfo, type FileSystem } from '@abele/sync-core'

/** How long the watcher waits for a burst to end before it reports a batch. */
const WATCH_DEBOUNCE_MS = 300
/** How long a batch may be held back by a burst that never lets up. */
const WATCH_MAX_WAIT_MS = 2000
/** How often the config folder is looked at, since no vault event describes it. */
const DEFAULT_POLL_MS = 30000

export interface ObsidianFileSystemOptions {
  /** How often the config folder is polled; 30 s by default. */
  pollMs?: number
  /** The clock the watcher's ceiling reads; `Date.now` by default. */
  now?: () => number
}

/**
 * The vault as the engine touches it, over Obsidian's own plugin API.
 *
 * Two halves of the vault are read two ways. Everything the user can see is in Obsidian's
 * file index, so `list` takes it from `vault.getFiles()` with the size and mtime the index
 * already holds — no stat per file on a vault of thousands. The config folder is invisible
 * to that index, so it is walked through `vault.adapter`, which is also what every read and
 * write goes through: the index has no bytes, and `vault.read` would hand back text where
 * the engine wants the file as it is on disk.
 *
 * **Writes here are not atomic.** `adapter.writeBinary` truncates the file and writes into
 * it; a crash mid-write leaves a short file where the engine's contract asks for either the
 * old bytes or the new ones. The alternative — a temp file beside it and a rename — puts a
 * half-written file inside the vault, where Obsidian's own indexer sees it, opens it, and
 * reports it to the plugin; the daemon can hide such a file in `.abele-sync/tmp` and a
 * plugin cannot. The engine survives the difference: a short file has the wrong hash, the
 * next scan calls it a local change, and the server sends the whole thing back.
 *
 * Names are passed through exactly as Obsidian reports them, because that spelling is what
 * `move` and `remove` have to name later; the engine folds a path to NFC itself when it puts
 * it on the wire.
 */
export class ObsidianFileSystem implements FileSystem {
  private readonly pollMs: number
  private readonly now: () => number
  /** Set while `watch` is running: what `kick` reaches for, and nothing when nobody watches. */
  private pollNow: (() => void) | null = null

  constructor(
    private readonly app: App,
    options: ObsidianFileSystemOptions = {}
  ) {
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
    this.now = options.now ?? ((): number => Date.now())
  }

  private get adapter(): DataAdapter {
    return this.app.vault.adapter
  }

  /**
   * The config folder's real name.
   *
   * It is `.obsidian` in every vault nobody has renamed it in, and the engine's selective
   * filter only knows that name — a vault with a renamed config folder syncs its settings as
   * ordinary files rather than under the settings switches. Read from the vault all the same:
   * the wrong folder walked here is a folder not synced at all.
   */
  private get configDir(): string {
    return this.app.vault.configDir
  }

  async *list(): AsyncIterable<FileInfo> {
    for (const file of this.app.vault.getFiles()) {
      yield { path: file.path, size: file.stat.size, mtime: stamp(file.stat.mtime) }
    }
    yield* this.walkConfig(this.configDir)
  }

  async read(path: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await this.adapter.readBinary(normalizePath(path)))
    } catch (cause) {
      throw new EngineError('io', `cannot read ${path}`, cause)
    }
  }

  async writeAtomic(path: string, bytes: Uint8Array, mtime: number): Promise<void> {
    const target = normalizePath(path)
    await this.onlyFileOrNothing(target, path)
    await this.makeParents(target)
    try {
      await this.adapter.writeBinary(target, bytesOf(bytes), { mtime })
    } catch (cause) {
      throw new EngineError('io', `cannot write ${path}`, cause)
    }
  }

  async move(from: string, to: string): Promise<void> {
    const source = normalizePath(from)
    const target = normalizePath(to)
    if (source === target) {
      if ((await this.stat(from)) === null) throw new EngineError('io', `no such file: ${from}`)
      return
    }
    // Neither end may be a folder: the engine believes it is moving a file onto a free name,
    // and a rename would happily carry a folder across or land inside one.
    await this.onlyFileOrNothing(source, from)
    await this.onlyFileOrNothing(target, to)

    const standing = await this.rawStat(target)
    if (standing !== null) {
      // A case-only rename on a case-folding disk finds the source under the target's own
      // spelling, and it must be renamed rather than refused (ruled 2026-09-05). The two are
      // told apart by their stats: one file answering to two names answers with itself.
      if (!caseOnly(source, target) || !(await this.sameFile(source, standing))) {
        throw new EngineError('io', `already exists: ${to}`)
      }
      await this.rename(source, target, from, to)
      // POSIX lets a rename between two names of one file do nothing at all, and some mounts
      // take it literally. Saying so beats reporting a spelling the disk never took.
      if (!(await this.spelledExactly(target))) {
        throw new EngineError('io', `this disk keeps ${from} spelled as it was`)
      }
      return
    }
    await this.makeParents(target)
    await this.rename(source, target, from, to)
  }

  async remove(path: string): Promise<void> {
    const target = normalizePath(path)
    const standing = await this.rawStat(target)
    if (standing === null) return
    if (standing.type !== 'file') throw conflictAt(path, standing)
    try {
      await this.adapter.remove(target)
    } catch (cause) {
      // Two removes of one file race, or the user deleted it while this one was asked for.
      if ((await this.rawStat(target)) === null) return
      throw new EngineError('io', `cannot remove ${path}`, cause)
    }
  }

  async stat(path: string): Promise<FileInfo | null> {
    const standing = await this.rawStat(normalizePath(path))
    if (standing === null || standing.type !== 'file') return null
    return { path, size: standing.size, mtime: stamp(standing.mtime) }
  }

  /**
   * Debounced batches of the paths Obsidian named, plus the config folder on a timer.
   *
   * Every path the vault reports is passed on. The engine keeps its own register of the
   * writes it made and drops its echoes when it looks at a batch, so a watcher that quietly
   * held one back would only be hiding a change the user made in the same second.
   *
   * Nothing in the plugin API reports a change under the config folder — Obsidian writes its
   * settings behind the vault's back — so that half is polled, and `css-change` and `kick`
   * are the two ways of not waiting for the next tick.
   */
  watch(cb: (paths: string[]) => void): () => void {
    const pending = new Set<string>()
    let timer: number | undefined
    let firstPendingAt = 0
    let stopped = false

    const fire = (): void => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
      firstPendingAt = 0
      if (stopped || pending.size === 0) return
      const paths = [...pending]
      pending.clear()
      console.debug(`[abele-sync] the vault changed at ${paths.length} path(s)`)
      cb(paths)
    }

    const add = (paths: string[]): void => {
      if (stopped) return
      for (const path of paths) if (path !== '') pending.add(path)
      if (pending.size === 0) return
      const now = this.now()
      if (firstPendingAt === 0) firstPendingAt = now
      // Past the ceiling the running timer is left alone, so a burst that never lets up still
      // hands over what it has instead of holding everything to the end.
      if (timer !== undefined && now - firstPendingAt >= WATCH_MAX_WAIT_MS) return
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(fire, WATCH_DEBOUNCE_MS)
    }

    /** The config folder as it was last seen; null until the first walk has finished. */
    let seen: Map<string, string> | null = null
    let walking = false
    let again = false
    const poll = async (): Promise<void> => {
      if (stopped) return
      // One walk at a time: a `kick` during a walk is answered by the walk after it, which
      // is the only one that can see what the kick was about.
      if (walking) {
        again = true
        return
      }
      walking = true
      try {
        do {
          again = false
          const taken = await this.configSnapshot()
          if (stopped) return
          if (seen !== null) {
            const changed = changedBetween(seen, taken)
            if (changed.length > 0) {
              add(changed)
              fire()
            }
          }
          seen = taken
        } while (again)
      } finally {
        walking = false
      }
    }

    const refs: EventRef[] = [
      this.app.vault.on('create', (file) => add(pathsOf(file))),
      this.app.vault.on('modify', (file) => add(pathsOf(file))),
      this.app.vault.on('delete', (file) => add(pathsOf(file))),
      this.app.vault.on('rename', (file, oldPath) => add(pathsOf(file, oldPath))),
    ]
    // Obsidian rewrites its appearance settings and then says the CSS changed; that is the
    // one moment it tells a plugin anything at all about the config folder.
    const cssRef = this.app.workspace.on('css-change', () => this.kick())

    const kick = (): void => void poll()
    this.pollNow = kick
    const ticker = window.setInterval(kick, this.pollMs)
    // The baseline, so the first tick reports what changed since watching began rather than
    // every settings file there is.
    kick()
    console.debug(`[abele-sync] watching the vault, ${this.configDir} every ${this.pollMs} ms`)

    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
      window.clearInterval(ticker)
      for (const ref of refs) this.app.vault.offref(ref)
      this.app.workspace.offref(cssRef)
      if (this.pollNow === kick) this.pollNow = null
      console.debug('[abele-sync] stopped watching the vault')
    }
  }

  /**
   * Look at the config folder now, without waiting for the next tick.
   *
   * The settings tab calls it after it has saved: Obsidian writes `data.json` itself, and a
   * user who changed a setting and watched nothing happen for half a minute would be right
   * to think the switch did nothing. Nothing to do when nobody is watching.
   */
  kick(): void {
    this.pollNow?.()
  }

  /* ── The disk underneath ─────────────────────────────────────────────── */

  /** Every file under `folder`, depth first, ignoring what is not there to be listed. */
  private async *walkConfig(folder: string): AsyncIterable<FileInfo> {
    let listed: ListedFiles
    try {
      listed = await this.adapter.list(normalizePath(folder))
    } catch {
      // A vault whose config folder has been renamed, or a folder removed while it was read.
      return
    }
    for (const path of listed.files) {
      const info = await this.stat(path)
      if (info !== null) yield info
    }
    for (const child of listed.folders) yield* this.walkConfig(child)
  }

  /** path → `size:mtime` for the whole config folder, which is what a poll compares. */
  private async configSnapshot(): Promise<Map<string, string>> {
    const taken = new Map<string, string>()
    for await (const info of this.walkConfig(this.configDir)) {
      taken.set(info.path, `${info.size}:${info.mtime}`)
    }
    return taken
  }

  private async rawStat(target: string): Promise<Stat | null> {
    try {
      return await this.adapter.stat(target)
    } catch {
      return null
    }
  }

  /**
   * A folder where the engine expects a file, or nothing, is `conflict` rather than `io`: the
   * engine holds that change and says so, instead of failing every sync on a write over a
   * directory. Obsidian's adapter reports what a link points at rather than the link, so a
   * symlink to a folder arrives here as the folder — which is the answer that matters.
   */
  private async onlyFileOrNothing(target: string, path: string): Promise<void> {
    const standing = await this.rawStat(target)
    if (standing === null || standing.type === 'file') return
    throw conflictAt(path, standing)
  }

  /** Whether two names are one file, as far as a stat can tell — see `move`. */
  private async sameFile(source: string, standing: Stat): Promise<boolean> {
    const origin = await this.rawStat(source)
    return (
      origin !== null &&
      origin.type === standing.type &&
      origin.size === standing.size &&
      origin.mtime === standing.mtime &&
      origin.ctime === standing.ctime
    )
  }

  /** Whether the folder holds this exact name, which is how a rename is known to have taken. */
  private async spelledExactly(target: string): Promise<boolean> {
    try {
      return (await this.adapter.list(folderOf(target))).files.includes(target)
    } catch {
      return false
    }
  }

  /** Every folder above `target`, created top down. Obsidian's `mkdir` is not recursive. */
  private async makeParents(target: string): Promise<void> {
    const segments = target.split('/')
    segments.pop()
    let folder = ''
    for (const segment of segments) {
      folder = folder === '' ? segment : `${folder}/${segment}`
      if (await this.adapter.exists(folder)) continue
      try {
        await this.adapter.mkdir(folder)
      } catch (cause) {
        // Two writes into one new folder race; the loser is told it exists, which is what it
        // asked for. Anything else is a folder that will not be made, and the write cannot go.
        if (!(await this.adapter.exists(folder))) {
          throw new EngineError('io', `cannot create the folder ${folder}`, cause)
        }
      }
    }
  }

  private async rename(source: string, target: string, from: string, to: string): Promise<void> {
    try {
      await this.adapter.rename(source, target)
    } catch (cause) {
      throw new EngineError('io', `cannot move ${from} to ${to}`, cause)
    }
  }
}

/**
 * Which on-disk paths one vault event is about.
 *
 * Obsidian names the thing that changed and nothing under it, so a folder renamed in the
 * sidebar arrives as one path though it moved every note inside. The children are named
 * here, under both spellings, or the engine would hear about the move and not about the
 * notes until its next full scan. The folder itself goes in too: it stats as nothing, and a
 * batch that holds it is still a reason to look at the vault.
 */
function pathsOf(file: TAbstractFile, oldPath?: string): string[] {
  const paths = [file.path]
  if (oldPath !== undefined) paths.push(oldPath)
  if (!(file instanceof TFolder)) return paths
  for (const path of filesUnder(file)) {
    paths.push(path)
    // `Notes/Trips/a.md` under `Notes/Trips` renamed from `Trips` is `Trips/a.md`.
    if (oldPath !== undefined) paths.push(oldPath + path.slice(file.path.length))
  }
  return paths
}

/** Every file below a folder, however deep. A deleted folder may already have none. */
function filesUnder(folder: TFolder): string[] {
  const paths: string[] = []
  for (const child of folder.children) {
    if (child instanceof TFolder) paths.push(...filesUnder(child))
    else paths.push(child.path)
  }
  return paths
}

/** What changed between two walks of the config folder: written, added, or gone. */
function changedBetween(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths: string[] = []
  for (const [path, mark] of after) if (before.get(path) !== mark) paths.push(path)
  for (const path of before.keys()) if (!after.has(path)) paths.push(path)
  return paths
}

/** The folder holding `target`; `/` for a file at the root, which is what `list` takes. */
function folderOf(target: string): string {
  const cut = target.lastIndexOf('/')
  return cut === -1 ? '/' : target.slice(0, cut)
}

/** Whether two paths are one name under two spellings. */
function caseOnly(source: string, target: string): boolean {
  return source.toLowerCase() === target.toLowerCase()
}

/** The wire has no time before 1970; a file that claims one is dated at the epoch. */
function stamp(mtime: number): number {
  return Math.max(0, Math.round(mtime))
}

function conflictAt(path: string, standing: Stat): EngineError {
  return new EngineError('conflict', `a ${standing.type} is at ${path}, where a file was expected`)
}

/**
 * The bytes as `writeBinary` takes them.
 *
 * The engine often holds a window onto a larger buffer, and only the window's own bytes may
 * be written; a view that is its whole buffer is passed through without copying it.
 */
function bytesOf(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes
  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) return buffer
    return buffer.slice(byteOffset, byteOffset + byteLength)
  }
  const copy = new ArrayBuffer(byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}
