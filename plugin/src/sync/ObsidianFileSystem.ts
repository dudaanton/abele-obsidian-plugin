import { TFolder } from 'obsidian'
import type { App, DataAdapter, EventRef, ListedFiles, Stat, TAbstractFile } from 'obsidian'
import { EngineError, type FileInfo, type FileSystem } from '@abele/sync-core'
import { caseKey } from '@abele/sync-protocol'

/** How long the watcher waits for a burst to end before it reports a batch. */
const WATCH_DEBOUNCE_MS = 300
/** How long a batch may be held back by a burst that never lets up. */
const WATCH_MAX_WAIT_MS = 2000
/** How often the config folder is looked at, since no vault event describes it. */
const DEFAULT_POLL_MS = 30000
/**
 * How deep the config walk goes. `.obsidian/plugins/<id>/…` is four; a plugin developer's
 * symlink into `node_modules`, or one pointing at an ancestor, has no bottom at all, and
 * `adapter.list` follows a link without saying it did.
 */
const CONFIG_WALK_DEPTH = 32

/**
 * The vault's ignore file. It lives at the root rather than under the config folder, and a
 * leading dot keeps it out of Obsidian's file index, so nothing but this poll would ever
 * notice it being edited.
 */
const IGNORE_FILE = '.abele-sync-ignore'

export interface ObsidianFileSystemOptions {
  /** How often the config folder is polled; 30 s by default. */
  pollMs?: number
  /** The clock the watcher's ceiling reads; `Date.now` by default. */
  now?: () => number
  /**
   * Handed every batch the engine is handed, for a host that watches for reasons of its own —
   * the service reconsiders what it syncs when `.abele-sync-ignore` changes. A throw here is
   * logged and swallowed: the engine's own batch must still go out.
   */
  onWatch?: (paths: string[]) => void
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
 *
 * Which is why `normalizePath` is nowhere in this file, though every `DataAdapter` method
 * asks for a normalized path. It folds a name to NFC and turns a non-breaking space into an
 * ordinary one — so a pulled `Trip A<nbsp>B.md` would be written under a name the ledger does
 * not hold and `list` would report the other one for ever, and on a filesystem that keeps
 * what it is given, a decomposed name would simply not be found. The engine validates the
 * paths it hands over; they go to the adapter exactly as they came.
 */
export class ObsidianFileSystem implements FileSystem {
  private readonly pollMs: number
  private readonly now: () => number
  private readonly onWatch: ((paths: string[]) => void) | null
  /** Set while `watch` is running: what `kick` reaches for, and nothing when nobody watches. */
  private pollNow: (() => void) | null = null

  constructor(
    private readonly app: App,
    options: ObsidianFileSystemOptions = {}
  ) {
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
    this.now = options.now ?? ((): number => Date.now())
    this.onWatch = options.onWatch ?? null
  }

  private get adapter(): DataAdapter {
    return this.app.vault.adapter
  }

  /**
   * The config folder's real name.
   *
   * It is `.obsidian` in every vault nobody has renamed it in, and the engine's selective
   * filter only knows that name — so the service keeps a renamed config folder out of the
   * sync altogether, rather than let it travel as ordinary files. Read from the vault all the
   * same: this is the folder that is really on the disk.
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
      return new Uint8Array(await this.adapter.readBinary(path))
    } catch (cause) {
      throw new EngineError('io', `cannot read ${path}`, cause)
    }
  }

  async writeAtomic(path: string, bytes: Uint8Array, mtime: number): Promise<void> {
    await this.onlyFileOrNothing(path)
    await this.makeParents(path)
    try {
      await this.adapter.writeBinary(path, bytesOf(bytes), { mtime })
    } catch (cause) {
      throw new EngineError('io', `cannot write ${path}`, cause)
    }
  }

  async move(from: string, to: string): Promise<void> {
    if (from === to) {
      if ((await this.stat(from)) === null) throw new EngineError('io', `no such file: ${from}`)
      return
    }
    // Neither end may be a folder: the engine believes it is moving a file onto a free name,
    // and a rename would happily carry a folder across or land inside one.
    await this.onlyFileOrNothing(from)
    await this.onlyFileOrNothing(to)

    const standing = await this.rawStat(to)
    if (standing !== null) {
      // A case-only rename on a case-folding disk finds the source under the target's own
      // spelling, and it must be renamed rather than refused (ruled 2026-09-05). The two are
      // told apart by their stats: one file answering to two names answers with itself.
      if (!caseOnly(from, to) || !(await this.sameFile(from, standing))) {
        // Somebody else's file holds the name. `conflict`, not `io`: the puller holds such a
        // change and writes the reason in the log, where an `io` fails the whole sync and
        // fails it again on every run until a human moves the file.
        throw new EngineError('conflict', `${to} is held by another file`)
      }
      await this.rename(from, to)
      // Only a listing that says outright that the old spelling is still there sends this
      // round again; a listing that would not answer leaves the rename as done.
      if ((await this.spelledExactly(to)) !== false) return
      await this.respell(from, to)
      return
    }
    await this.makeParents(to)
    await this.rename(from, to)
  }

  async remove(path: string): Promise<void> {
    const standing = await this.rawStat(path)
    if (standing === null) return
    if (standing.type !== 'file') throw conflictAt(path, standing)
    try {
      await this.adapter.remove(path)
    } catch (cause) {
      // Two removes of one file race, or the user deleted it while this one was asked for.
      if ((await this.rawStat(path)) === null) return
      throw new EngineError('io', `cannot remove ${path}`, cause)
    }
  }

  async stat(path: string): Promise<FileInfo | null> {
    const standing = await this.rawStat(path)
    if (standing === null || standing.type !== 'file') return null
    // The path that was statted, spelled as it was asked for: the engine matches what comes
    // back against what it holds, and a name it did not ask about would be a different file.
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
      try {
        this.onWatch?.(paths)
      } catch (error) {
        console.debug('[abele-sync] the host threw at a batch of changes', error)
      }
      try {
        cb(paths)
      } catch (error) {
        // Whoever is listening threw. The batch is spent either way — holding it back would
        // report the same paths on every tick from here on.
        console.debug('[abele-sync] a listener threw at a batch of changes', error)
      }
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
          let taken: Map<string, string>
          try {
            taken = await this.configSnapshot()
          } catch (error) {
            // A folder that would not be listed is not a reason to say its files are gone.
            console.debug('[abele-sync] cannot read the settings folder', error)
            continue
          }
          if (stopped) return
          const before = seen
          // Written down before anything is reported: a listener that throws must not leave
          // the watcher holding the old snapshot and reporting the same batch for ever.
          seen = taken
          if (before === null) continue
          const changed = changedBetween(before, taken)
          if (changed.length > 0) {
            add(changed)
            fire()
          }
        } while (again)
      } finally {
        walking = false
      }
    }

    const kick = (): void => void poll()

    const refs: EventRef[] = [
      this.app.vault.on('create', (file) => add(pathsOf(file))),
      this.app.vault.on('modify', (file) => add(pathsOf(file))),
      this.app.vault.on('delete', (file) => add(pathsOf(file))),
      this.app.vault.on('rename', (file, oldPath) => add(pathsOf(file, oldPath))),
    ]
    // Obsidian rewrites its appearance settings and then says the CSS changed; that is the
    // one moment it tells a plugin anything at all about the config folder. This watcher's
    // own poll, not `this.kick()`, which is whichever watcher started last.
    const cssRef = this.app.workspace.on('css-change', kick)

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

  /**
   * Every file under `folder`, depth first.
   *
   * A folder that is not there yields nothing — a fresh vault has no `plugins`, and one can
   * go while it is being read. A folder that is there and would not be listed **throws**: a
   * scan that took a failed listing for an empty folder would tell the server every settings
   * file had been deleted, and the server would believe it.
   *
   * `adapter.list` follows a symbolic link without saying it did, so the walk carries a depth
   * and the folders it has already been through: a plugin developer's link into
   * `node_modules`, or one pointing at an ancestor, would otherwise never end.
   */
  private async *walkConfig(
    folder: string,
    depth = 0,
    walked: Set<string> = new Set()
  ): AsyncIterable<FileInfo> {
    if (depth > CONFIG_WALK_DEPTH || walked.has(folder)) {
      console.debug(`[abele-sync] not following ${folder} any further`)
      return
    }
    walked.add(folder)

    let listed: ListedFiles
    try {
      listed = await this.adapter.list(folder)
    } catch (cause) {
      // Asked only when the listing failed, which is the one moment the answer matters.
      if (!(await this.there(folder))) return
      throw new EngineError('io', `cannot list ${folder}`, cause)
    }
    for (const path of listed.files) {
      const info = await this.stat(path)
      if (info !== null) yield info
    }
    for (const child of listed.folders) yield* this.walkConfig(child, depth + 1, walked)
  }

  /** Whether the path is there; a question that cannot be answered is answered with yes. */
  private async there(path: string): Promise<boolean> {
    try {
      return await this.adapter.exists(path)
    } catch {
      return true
    }
  }

  /**
   * path → `size:mtime` for the whole config folder and the vault's ignore file, which is what
   * a poll compares.
   *
   * The ignore file costs one `stat` a tick and is the only way an edit to it is ever reported:
   * it is neither in the file index nor under the config folder.
   */
  private async configSnapshot(): Promise<Map<string, string>> {
    const taken = new Map<string, string>()
    for await (const info of this.walkConfig(this.configDir)) {
      taken.set(info.path, `${info.size}:${info.mtime}`)
    }
    const ignore = await this.stat(IGNORE_FILE)
    if (ignore !== null) taken.set(ignore.path, `${ignore.size}:${ignore.mtime}`)
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
  private async onlyFileOrNothing(path: string): Promise<void> {
    const standing = await this.rawStat(path)
    if (standing === null || standing.type === 'file') return
    throw conflictAt(path, standing)
  }

  /**
   * Whether two names are one file, as far as a stat can tell — see `move`.
   *
   * Obsidian's own rename refuses an existing destination except for a case-only rename on a
   * case-insensitive volume, so the worst a stat collision can cost is a spurious error: two
   * distinct files agreeing on type, size, mtime and ctime would be let through here and
   * refused by the disk, never renamed one over the other.
   */
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

  /**
   * Whether the folder holds this exact name, which is how a rename is known to have taken.
   * Null when the listing could not say.
   *
   * Case matters, since case is the whole question; the decomposition does not, because
   * Obsidian composes what it lists whatever the disk keeps underneath. A listing that failed
   * is *not* a no: read as one, a rename that has already happened would be sent round again
   * and reported as a conflict the vault would hold for ever.
   */
  private async spelledExactly(target: string): Promise<boolean | null> {
    const wanted = target.normalize('NFC')
    try {
      const listed = await this.adapter.list(folderOf(target))
      return listed.files.some((held) => held.normalize('NFC') === wanted)
    } catch {
      return null
    }
  }

  /**
   * The folder a file goes in, made if it is not there.
   *
   * One `exists` and one `mkdir`: on the desktop `mkdir` is `fs.mkdir` with `recursive`, so
   * it makes the whole chain, and walking the segments would cost a round trip each for a
   * depth every write reaches. The chain is only walked when the one call did not do it,
   * which is what a host whose `mkdir` makes one folder at a time would look like.
   */
  private async makeParents(target: string): Promise<void> {
    const cut = target.lastIndexOf('/')
    if (cut <= 0) return
    const folder = target.slice(0, cut)
    if (await this.adapter.exists(folder)) return
    const failed = await this.tryMkdir(folder)
    if (failed === null) return

    let walked = ''
    for (const segment of folder.split('/')) {
      walked = walked === '' ? segment : `${walked}/${segment}`
      await this.tryMkdir(walked)
    }
    if (!(await this.adapter.exists(folder))) {
      throw new EngineError('io', `cannot create the folder ${folder}`, failed)
    }
  }

  /** Makes a folder; answers what went wrong, or null when the folder is there afterwards. */
  private async tryMkdir(folder: string): Promise<unknown> {
    try {
      await this.adapter.mkdir(folder)
      return null
    } catch (cause) {
      // Two writes into one new folder race; the loser is told it exists, which is what it
      // asked for.
      return (await this.adapter.exists(folder)) ? null : cause
    }
  }

  private async rename(from: string, to: string): Promise<void> {
    try {
      await this.adapter.rename(from, to)
    } catch (cause) {
      // A name taken between the look and the rename — by the user, or by Obsidian itself —
      // is the puller's to hold rather than the sync's to fail on. Anything else is a disk
      // that would not do it, which the engine should hear about as a failure.
      if ((await this.rawStat(to)) !== null) {
        throw new EngineError('conflict', `${to} is held by another file`, cause)
      }
      throw new EngineError('io', `cannot move ${from} to ${to}`, cause)
    }
  }

  /**
   * The new spelling of a name the disk would not respell in one go.
   *
   * POSIX lets `rename` between two names of one file do nothing at all, and some mounts take
   * it literally, so the file goes out to a name nothing holds and comes back under the
   * spelling that was asked for. There is no half-written file to leave behind — a rename
   * carries the whole thing or none of it — and a crash between the two steps leaves the
   * bytes under the temp name, which the next scan reports as a file the server has not seen.
   */
  private async respell(from: string, to: string): Promise<void> {
    const temp = await this.tempBeside(to)
    // Out from `to`, not from `from`: on the disk this is for, both names answer to the one
    // file, and `to` is the one that is there whether the rename before this took or not.
    try {
      await this.adapter.rename(to, temp)
    } catch (cause) {
      throw new EngineError('conflict', `cannot spell ${from} as ${to}`, cause)
    }
    try {
      await this.adapter.rename(temp, to)
    } catch (cause) {
      // Back under the name it had, rather than leaving the vault holding a temp name. A
      // disk that will not do that either leaves the bytes under the temp name, which the
      // next scan reports as a file the server has not seen — nothing is lost.
      try {
        await this.adapter.rename(temp, from)
      } catch {
        console.debug(`[abele-sync] ${from} is left at ${temp}`)
      }
      throw new EngineError('conflict', `cannot spell ${from} as ${to}`, cause)
    }
    if ((await this.spelledExactly(to)) === false) {
      throw new EngineError('conflict', `this disk keeps ${from} spelled as it was`)
    }
  }

  /**
   * A free name in the same folder to rename through.
   *
   * Short, and beside the file rather than built on its name: a segment may already be at the
   * 255 bytes a filesystem allows, and twenty more would make the rename fail with a name too
   * long — a hold the vault would never get out of. The leading dot keeps it out of Obsidian's
   * file index for the moment it exists.
   */
  private async tempBeside(to: string): Promise<string> {
    const cut = to.lastIndexOf('/')
    const folder = cut === -1 ? '' : to.slice(0, cut)
    for (let attempt = 0; attempt < 2; attempt++) {
      const stem = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
      const path = folder === '' ? `.abele-sync-${stem}.tmp` : `${folder}/.abele-sync-${stem}.tmp`
      if ((await this.rawStat(path)) === null) return path
    }
    throw new EngineError('conflict', `no free name beside ${to} to rename ${to} through`)
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

/**
 * Whether two paths are one name under two spellings.
 *
 * `caseKey` is the protocol's own fold — NFC, then lower case — and it has to be both:
 * a vault on macOS keeps `Café.md` decomposed, the server sends it back composed, and a
 * comparison that only folded case would call the two different files and hold the rename
 * for ever.
 */
function caseOnly(source: string, target: string): boolean {
  return caseKey(source) === caseKey(target)
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
