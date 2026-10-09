import type { App, DataAdapter, ListedFiles, Stat } from 'obsidian'
import {
  EngineError,
  sha256,
  type FileInfo,
  type FileSystem,
  type StateStore,
} from '@abele/sync-core'
import { caseKey } from '@abele/sync-protocol'
import { watchVault } from './vaultWatcher'
import { fencedPort, type RuntimeFence } from './external/recovery'
import { folderMutations } from './folderMutations'
import type { LocalStorage } from './ledgerId'
import { makeParents, pruneAbove } from './vaultFolders'
import {
  bytesOf,
  isAdapterTemp,
  isDroppableTemp,
  nativeOf,
  storageOf,
  VaultWriter,
  WriteJournal,
  type NativeFs,
} from './vaultWrites'

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
  /** The startup/ownership fence, owned by the engine host. */
  runtimeFence?: RuntimeFence
  /** Durable restrictive provenance, completed before native bytes or paths change. */
  beforeEngineMutation?: (paths: string[]) => Promise<void>

  /** Ledger paths absent from the index are checked on disk before a scan calls them deleted. */
  ledger?: Pick<StateStore, 'all'>
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
  /**
   * Told the path of every file the engine wrote, moved (both names) or removed, once the disk
   * has taken it. The engine writes only what it pulls, so this is how the host learns that a
   * pull changed a file it reads itself — the plugin's own `data.json` (`OwnSettingsWatch`). A
   * throw here is logged and swallowed: the engine's write has happened either way.
   */
  onEngineWrite?: (path: string) => void
  /**
   * Whether the copy of a file here must lose to the server's: while it says so, the file is
   * listed with mtime 0, the oldest the wire has. The plugin's own `data.json` before the ledger
   * holds it (`OwnSettingsWatch.yields`): sent as a create against the vault's head, it loses
   * the server's newer-mtime race, is kept in the head's history, and the head is written here.
   * Asked only for files of the config folder, where that file is.
   *
   * A `stat` says mtime 0 too, but only while the file is still what the listing found. The
   * pusher stats a file before it writes the server's answer over it, to see whether it changed
   * while the op was in the air; always answering 0 there would hide an edit that left the size
   * alone, and the head would be written over bytes no version holds. Changed since, the stat
   * tells the truth, the answer is not written, and the next scan sends the edit — yielding again.
   */
  yieldsToServer?: (path: string) => Promise<boolean>
  /**
   * Where unfinished replacements are written down (`vaultWrites.ts`); the vault's own local
   * storage, through the app, by default.
   */
  storage?: LocalStorage
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
 * **Writes are whole or not at all** (`vaultWrites.ts`): the new bytes go to a hidden temp
 * name beside the file and take its name only once they are all there, so a crash leaves the
 * old file as it was. A short file would be read by the next scan as an edit made here and
 * sent to every device. The temp names start with a dot, which keeps them out of Obsidian's
 * file index, and the config-folder walk skips them by name.
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
  private readonly onEngineWrite: ((path: string) => void) | null
  private readonly yieldsToServer: ((path: string) => Promise<boolean>) | null
  /**
   * The size and mtime the last listing found for each file it reported as yielding, by path:
   * what a `stat` compares against before it answers mtime 0 (`yieldsToServer`).
   */
  private readonly yielded = new Map<string, string>()
  /** Last engine-visible byte/absence observation, not a fresh read inside a replacement.
   * Digests avoid retaining the vault's binary contents. A later stat never promotes new bytes. */
  private readonly observedBases = new Map<string, { sha: string } | { absent: true }>()
  private readonly ledger: Pick<StateStore, 'all'> | null
  /** Pulls can finish before Obsidian's file index sees their adapter renames. */
  private readonly awaitingIndex = new Set<string>()
  /** Set while `watch` is running: what `kick` reaches for, and nothing when nobody watches. */
  private pollNow: (() => void) | null = null
  private readonly writer: VaultWriter
  private readonly journal: WriteJournal
  private readonly beforeEngineMutation: ((paths: string[]) => Promise<void>) | null
  private readonly runtimeFence: RuntimeFence | null
  private readonly guardedAdapter: DataAdapter

  constructor(
    private readonly app: App,
    options: ObsidianFileSystemOptions = {}
  ) {
    this.runtimeFence = options.runtimeFence ?? null
    this.guardedAdapter = this.runtimeFence
      ? fencedPort(
          app.vault.adapter,
          this.runtimeFence,
          [
            'write',
            'writeBinary',
            'append',
            'process',
            'mkdir',
            'rename',
            'remove',
            'rmdir',
            'copy',
          ],
          false
        )
      : app.vault.adapter
    this.beforeEngineMutation = options.beforeEngineMutation ?? null
    this.ledger = options.ledger ?? null
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
    this.now = options.now ?? ((): number => Date.now())
    this.onWatch = options.onWatch ?? null
    this.onEngineWrite = options.onEngineWrite ?? null
    this.yieldsToServer = options.yieldsToServer ?? null
    this.journal = new WriteJournal(options.storage ?? storageOf(app), () =>
      this.runtimeFence?.assertOwned()
    )
    this.writer = new VaultWriter({
      adapter: this.guardedAdapter,
      native: this.native,
      journal: this.journal,
      indexed: (path) => app.vault.getAbstractFileByPath(path) !== null,
      makeParents: (path) => makeParents(this.adapter, path),
      installed: (path) => {
        this.awaitingIndex.add(path)
        this.wrote(path)
      },
    })
  }

  /** Obsidian desktop's `fs.promises`, or null on a phone (`vaultWrites.nativeOf`). */
  private get native(): NativeFs | null {
    const native = nativeOf(this.adapter, () => this.runtimeFence?.assertOwned())
    return native && this.runtimeFence
      ? fencedPort(
          native,
          this.runtimeFence,
          ['rename', 'rmdirEmpty', 'replaceFenced', 'installExclusive'],
          false
        )
      : native
  }

  private get adapter(): DataAdapter {
    return this.guardedAdapter
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

  /** Existing installation recovery runs before scanner/watcher activation. */
  async recover(): Promise<void> {
    this.runtimeFence?.assertOwned()
    await this.writer.recover()
    this.runtimeFence?.assertOwned()
  }

  async *list(): AsyncIterable<FileInfo> {
    this.runtimeFence?.assertReady()
    await this.writer.recover()
    const mutations = folderMutations(this.app.vault)
    await mutations.settled()
    const revision = mutations.revision
    const indexed = new Set<string>()
    for (const file of this.app.vault.getFiles()) {
      if (isAdapterTemp(file.path)) continue
      indexed.add(caseKey(file.path))
      yield { path: file.path, size: file.stat.size, mtime: stamp(file.stat.mtime) }
    }
    // A pull can finish before the index sees its adapter renames, including across engine
    // rebuilds and app restarts. The ledger is authoritative about what might still be on disk.
    const candidates = new Set(this.awaitingIndex)
    if (this.ledger !== null) {
      for await (const entry of this.ledger.all()) candidates.add(entry.path)
    }
    for (const path of candidates) {
      if (indexed.has(caseKey(path)) || path.startsWith(`${this.configDir}/`)) {
        this.awaitingIndex.delete(path)
        continue
      }
      // stat alone on a case-folding disk would keep a phantom Report.md after a rename to
      // report.md. List its parent for the actual spelling, and never yield both names.
      const actual = await this.spellingOnDisk(path)
      const info = actual === null ? null : await this.fileAt(actual)
      if (info !== null && !indexed.has(caseKey(info.path))) {
        indexed.add(caseKey(info.path))
        yield info
      }
      if (info === null || actual !== path) this.awaitingIndex.delete(path)
    }
    for await (const info of this.walkConfig(this.configDir)) yield await this.told(info, true)
    if (mutations.revision !== revision) {
      throw new EngineError(
        'io',
        'a folder deletion started during the scan; scan again after it finishes'
      )
    }
  }

  /**
   * A file as the engine is told of it: see `yieldsToServer`. `listed` is a listing's report,
   * which is remembered; a `stat`'s is compared with it.
   */
  private async told(info: FileInfo, listed: boolean): Promise<FileInfo> {
    if (this.yieldsToServer === null || !info.path.startsWith(`${this.configDir}/`)) return info
    if (!(await this.yieldsToServer(info.path))) {
      this.yielded.delete(info.path)
      return info
    }
    const seen = `${info.size}:${info.mtime}`
    if (listed) this.yielded.set(info.path, seen)
    else if ((this.yielded.get(info.path) ?? seen) !== seen) return info
    return { ...info, mtime: 0 }
  }

  async read(path: string): Promise<Uint8Array> {
    try {
      const bytes = new Uint8Array(await this.adapter.readBinary(path))
      this.observedBases.set(caseKey(path), { sha: await sha256(bytes) })
      return bytes
    } catch (cause) {
      throw new EngineError('io', `cannot read ${path}`, cause)
    }
  }

  async writeAtomic(path: string, bytes: Uint8Array, mtime: number): Promise<void> {
    this.runtimeFence?.assertReady()
    const key = caseKey(path),
      expected = this.observedBases.get(key)
    const standing = await this.onlyFileOrNothing(path)
    const before = standing === null ? null : await this.adapter.readBinary(path)
    if (
      expected &&
      (('absent' in expected && before !== null) ||
        ('sha' in expected &&
          (before === null || (await sha256(new Uint8Array(before))) !== expected.sha)))
    )
      throw new EngineError('conflict', `${path} changed since the engine byte decision`)
    // Capture BEFORE the awaited provenance/publication hold. The native final fence must
    // compare these authorized bytes, not adopt a local save that arrives during that await.
    await this.beforeEngineMutation?.([path])
    await this.writer.write(path, bytesOf(bytes), mtime, standing !== null, before)
    this.observedBases.delete(key)
  }

  async move(from: string, to: string): Promise<void> {
    this.runtimeFence?.assertReady()
    await this.beforeEngineMutation?.([from, to])
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
      this.awaitingIndex.delete(from)
      this.awaitingIndex.add(to)
      this.wrote(from, to)
      // Only a listing that says outright that the old spelling is still there sends this
      // round again; a listing that would not answer leaves the rename as done.
      if ((await this.spelledExactly(to)) !== false) return
      await this.writer.respell(from, to, (path) => this.spelledExactly(path))
      return
    }
    await makeParents(this.adapter, to)
    await this.rename(from, to)
    this.awaitingIndex.delete(from)
    this.awaitingIndex.add(to)
    this.wrote(from, to)
    await pruneAbove(this.adapter, this.native, this.configDir, from)
  }

  async remove(path: string): Promise<void> {
    this.runtimeFence?.assertReady()
    await this.beforeEngineMutation?.([path])
    const standing = await this.rawStat(path)
    if (standing === null) return
    if (standing.type !== 'file') throw conflictAt(path, standing)
    try {
      await this.adapter.remove(path)
    } catch (cause) {
      if (cause instanceof EngineError && cause.code === 'lost') throw cause
      // Two removes of one file race, or the user deleted it while this one was asked for.
      if ((await this.rawStat(path)) === null) return
      throw new EngineError('io', `cannot remove ${path}`, cause)
    }
    this.awaitingIndex.delete(path)
    this.wrote(path)
    await pruneAbove(this.adapter, this.native, this.configDir, path)
  }

  /** Tell the host what the engine changed on disk (`onEngineWrite`). */
  private wrote(...paths: string[]): void {
    this.runtimeFence?.assertOwned()
    if (this.onEngineWrite === null) return
    for (const path of paths) {
      try {
        this.onEngineWrite(path)
      } catch (error) {
        console.debug('[abele-sync] the host would not take a write', error)
      }
    }
  }

  async stat(path: string): Promise<FileInfo | null> {
    const info = await this.fileAt(path)
    if (info === null) this.observedBases.set(caseKey(path), { absent: true })
    return info === null ? null : this.told(info, false)
  }

  /** The file at `path` as the disk has it, before `told`; null for none, or not a file. */
  private async fileAt(path: string): Promise<FileInfo | null> {
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
    this.runtimeFence?.assertReady()
    const stopMutations = folderMutations(this.app.vault).watch()
    const watcher = watchVault(
      {
        app: this.app,
        now: this.now,
        onWatch: this.onWatch,
        pollMs: this.pollMs,
        configDir: this.configDir,
        snapshot: () => this.configSnapshot(),
      },
      cb
    )
    this.pollNow = watcher.kick
    return () => {
      watcher.stop()
      stopMutations()
      if (this.pollNow === watcher.kick) this.pollNow = null
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
      if (isAdapterTemp(path)) {
        // A temp of new bytes a killed write left behind goes; a backup is somebody's only
        // copy, and the write journal puts it back.
        if (isDroppableTemp(path)) await this.sweep(path)
        continue
      }
      const info = await this.fileAt(path)
      if (info !== null) yield info
    }
    for (const child of listed.folders) yield* this.walkConfig(child, depth + 1, walked)
  }

  private async sweep(path: string): Promise<void> {
    try {
      await this.adapter.remove(path)
      console.debug(`[abele-sync] removed ${path}, left by a write that did not finish`)
    } catch (error) {
      console.debug(`[abele-sync] could not remove ${path}`, error)
    }
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

  private async spellingOnDisk(path: string): Promise<string | null> {
    const cut = path.lastIndexOf('/')
    const parent = cut === -1 ? '/' : path.slice(0, cut)
    try {
      const listing = await this.adapter.list(parent)
      return listing.files.find((file) => caseKey(file) === caseKey(path)) ?? null
    } catch (cause) {
      if (notFound(cause)) return null
      throw new EngineError('io', `cannot list ${parent}`, cause)
    }
  }

  private async rawStat(target: string): Promise<Stat | null> {
    try {
      return await this.adapter.stat(target)
    } catch (cause) {
      if (notFound(cause)) return null
      throw new EngineError('io', `cannot stat ${target}`, cause)
    }
  }

  /**
   * A folder where the engine expects a file, or nothing, is `conflict` rather than `io`: the
   * engine holds that change and says so, instead of failing every sync on a write over a
   * directory. Obsidian's adapter reports what a link points at rather than the link, so a
   * symlink to a folder arrives here as the folder — which is the answer that matters.
   */
  private async onlyFileOrNothing(path: string): Promise<Stat | null> {
    const standing = await this.rawStat(path)
    if (standing === null || standing.type === 'file') return standing
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

  private async rename(from: string, to: string): Promise<void> {
    try {
      const base = this.observedBases.get(caseKey(from))
      await this.adapter.rename(from, to)
      if (caseKey(from) !== caseKey(to)) {
        this.observedBases.set(caseKey(from), { absent: true })
        if (base) this.observedBases.set(caseKey(to), base)
        else this.observedBases.delete(caseKey(to))
      }
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

/** Adapter null and explicit missing-path errors mean absent; access and I/O errors do not. */
function notFound(cause: unknown): boolean {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : null
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function conflictAt(path: string, standing: Stat): EngineError {
  return new EngineError('conflict', `a ${standing.type} is at ${path}, where a file was expected`)
}
