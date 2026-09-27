import type { App, DataAdapter } from 'obsidian'
import { EngineError } from '@abele/sync-core'
import { caseKey } from '@abele/sync-protocol'
import type { LocalStorage } from './ledgerId'

/**
 * How the sync replaces a file in the vault without ever leaving half of one behind.
 *
 * The engine's `writeAtomic` asks for the old bytes or the new ones and nothing in between: a
 * short file is read by the next scan as an edit made here, and sent to every device (pi review
 * #1). `adapter.writeBinary` truncates the file and writes into it, so it cannot be used on the
 * file itself. The new bytes go to a temp name beside it instead, in full, and only then take the
 * file's name.
 *
 * Obsidian's `adapter.rename` refuses a name that is taken, on the desktop and on a phone alike
 * (`Destination file already exists!`), so how the name is taken depends on what is underneath:
 *
 * - **Desktop.** The adapter is Node's `fs` under a queue, and holds it as `fsPromises`;
 *   `getFullPath` maps a vault path to the disk's own spelling of it. `rename(2)` over an existing
 *   file replaces it in one step — the file is the old one or the new one at every instant.
 * - **Anything else (a phone).** Capacitor's filesystem is reachable only through the adapter, so
 *   the file steps aside first: the old one to a backup name, the new one into its place, the
 *   backup removed. Between the two renames the file is at the backup name and nowhere else, so
 *   every step is written down first in this vault's local storage (`JOURNAL_KEY`), and the next
 *   listing puts back whatever a crash left half done, before the scan can read the gap as a
 *   delete.
 *
 * The temp and backup names start with a dot, which keeps them out of Obsidian's file index, and
 * `isAdapterTemp` keeps them out of the config-folder walk, where hidden names are listed.
 */

/** Where the unfinished replacements are written down, in this vault's local storage. */
export const JOURNAL_KEY = 'abele-sync-writes'

/** A replacement under way: the file, the new bytes' temp name, and the old bytes' backup name. */
export interface JournalEntry {
  target: string
  temp?: string
  backup?: string
}

/**
 * The temp names this process is using right now, whichever `ObsidianFileSystem` made them — a
 * second one (the join dialog counts files with its own) must not tidy away a live write.
 */
const inFlight = new Set<string>()

/** `.abele-sync-<8>.tmp` holds new bytes (safe to drop); `.old` holds the only copy of a file. */
const TEMP_NAME = /^\.abele-sync-[a-z0-9]{8}\.(tmp|old)$/

/** Whether a path is one of the names this file writes through, so no listing reports it. */
export function isAdapterTemp(path: string): boolean {
  return TEMP_NAME.test(path.slice(path.lastIndexOf('/') + 1))
}

/** Whether it is a temp holding new bytes only, which a sweep may remove. */
export function isDroppableTemp(path: string): boolean {
  return isAdapterTemp(path) && path.endsWith('.tmp') && !inFlight.has(path)
}

/** Node's `fs.promises`, as Obsidian's desktop adapter holds it. */
interface NodeFsPromises {
  rename(from: string, to: string): Promise<void>
  rmdir(path: string): Promise<void>
}

/** The desktop adapter's own hands on the disk; null on a phone. */
export interface NativeFs {
  /** `rename(2)`: replaces a file standing at `to`. */
  rename(from: string, to: string): Promise<void>
  /** `rmdir(2)`: removes an empty folder and refuses (ENOTEMPTY) one holding anything. */
  rmdirEmpty(folder: string): Promise<void>
}

/**
 * Obsidian desktop's `fs.promises` and `getFullPath`, when this adapter has them — the
 * `FileSystemAdapter`. Neither the phone's adapter nor a test's fake does, and both are then
 * driven through the adapter's public methods alone.
 */
export function nativeOf(adapter: DataAdapter): NativeFs | null {
  const raw = adapter as unknown as {
    fsPromises?: Partial<NodeFsPromises>
    getFullPath?: (path: string) => string
    reconcileInternalFile?: (path: string) => Promise<void>
  }
  const fsp = raw.fsPromises
  const full = raw.getFullPath
  if (
    typeof full !== 'function' ||
    fsp === undefined ||
    typeof fsp.rename !== 'function' ||
    typeof fsp.rmdir !== 'function'
  ) {
    return null
  }
  const rename = fsp.rename.bind(fsp)
  const rmdir = fsp.rmdir.bind(fsp)
  const at = (path: string): string => full.call(adapter, path)
  /**
   * The adapter's picture of the disk brought up to date at once, as its own methods do after
   * every write; the file watcher would get there too, a moment later.
   */
  const reconcile = async (...paths: string[]): Promise<void> => {
    if (typeof raw.reconcileInternalFile !== 'function') return
    for (const path of paths) {
      try {
        await raw.reconcileInternalFile.call(adapter, path)
      } catch (error) {
        console.debug(`[abele-sync] Obsidian did not look at ${path} again`, error)
      }
    }
  }
  return {
    async rename(from, to) {
      await rename(at(from), at(to))
      await reconcile(from, to)
    },
    async rmdirEmpty(folder) {
      await rmdir(at(folder))
      await reconcile(folder)
    },
  }
}

/** The journal of replacements under way, in this vault's local storage. */
export class WriteJournal {
  constructor(private readonly storage: LocalStorage | null) {}

  entries(): JournalEntry[] {
    let raw: unknown
    try {
      raw = this.storage?.loadLocalStorage(JOURNAL_KEY) ?? null
    } catch {
      return []
    }
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (entry): entry is JournalEntry =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as JournalEntry).target === 'string'
    )
  }

  add(entry: JournalEntry): void {
    this.save([...this.entries(), entry])
  }

  drop(entry: JournalEntry): void {
    this.save(this.entries().filter((held) => !sameEntry(held, entry)))
  }

  private save(entries: JournalEntry[]): void {
    try {
      this.storage?.saveLocalStorage(JOURNAL_KEY, entries.length === 0 ? null : entries)
    } catch (error) {
      // Nothing to fall back on: the write goes ahead, and a crash inside it is not put back.
      console.debug('[abele-sync] the write journal could not be saved', error)
    }
  }
}

const sameEntry = (a: JournalEntry, b: JournalEntry): boolean =>
  a.target === b.target && a.temp === b.temp && a.backup === b.backup

/** What `VaultWriter` is handed by the file system that owns it. */
export interface WriterDeps {
  adapter: DataAdapter
  native: NativeFs | null
  journal: WriteJournal
  /** Whether the vault's file index holds this exact path. */
  indexed(path: string): boolean
  /** Folders above `path` made. */
  makeParents(path: string): Promise<void>
}

export class VaultWriter {
  constructor(private readonly deps: WriterDeps) {}

  private get adapter(): DataAdapter {
    return this.deps.adapter
  }

  /**
   * `bytes` at `path`, dated `mtime`, the old file or the new one at every instant. `exists` says
   * whether a file stands at `path` now, which decides between taking a free name and replacing.
   */
  async write(path: string, bytes: ArrayBuffer, mtime: number, exists: boolean): Promise<void> {
    await this.deps.makeParents(path)
    const temp = await this.freeName(path, 'tmp')
    let entry: JournalEntry = { target: path, temp }
    inFlight.add(temp)
    this.deps.journal.add(entry)
    try {
      try {
        await this.adapter.writeBinary(temp, bytes, { mtime })
      } catch (cause) {
        throw new EngineError('io', `cannot write ${path}`, cause)
      }
      if (!exists) await this.takeFreeName(temp, path)
      else if (this.deps.native !== null) {
        await this.replaceNative(this.deps.native, temp, await this.held(path))
      } else {
        const held = await this.held(path)
        const backup = await this.freeName(path, 'old')
        const swapping: JournalEntry = { target: held, temp, backup }
        this.deps.journal.drop(entry)
        this.deps.journal.add(swapping)
        entry = swapping
        if (!(await this.replaceBySwap(temp, held, backup))) {
          // The old file could not be put back under its name: the entry stays for the next
          // listing, which tries again.
          await this.dropQuietly(temp)
          inFlight.delete(temp)
          throw new EngineError('io', `cannot write ${path}; ${held} is kept at ${backup}`)
        }
        // A backup that would not be removed stays in the journal, for the next listing.
        if (await this.there(backup)) return
      }
    } catch (error) {
      if (inFlight.has(temp)) {
        await this.dropQuietly(temp)
        this.deps.journal.drop(entry)
      }
      throw error
    } finally {
      inFlight.delete(temp)
    }
    this.deps.journal.drop(entry)
  }

  /** A file that was not there: the temp takes the name, which the adapter refuses if taken. */
  private async takeFreeName(temp: string, path: string): Promise<void> {
    try {
      await this.adapter.rename(temp, path)
    } catch (cause) {
      // Somebody made the file in the moment since it was looked for. Theirs is not written over;
      // the puller holds the change and the next scan sends theirs.
      if (await this.there(path)) {
        throw new EngineError('conflict', `${path} is held by another file`, cause)
      }
      throw new EngineError('io', `cannot write ${path}`, cause)
    }
  }

  /** The desktop: one `rename(2)` over the old file. */
  private async replaceNative(native: NativeFs, temp: string, path: string): Promise<void> {
    try {
      await native.rename(temp, path)
    } catch (cause) {
      throw new EngineError('io', `cannot write ${path}`, cause)
    }
  }

  /**
   * A phone: the old file to its backup name, the new one into its place, the backup removed —
   * written down in the journal first, so a crash between them is put back (`recover`). False
   * when the new file would not take the name and the old one would not go back under it either:
   * it is left at the backup name, for the next listing to put back.
   */
  private async replaceBySwap(temp: string, path: string, backup: string): Promise<boolean> {
    inFlight.add(backup)
    try {
      try {
        await this.adapter.rename(path, backup)
      } catch (cause) {
        throw new EngineError('io', `cannot write ${path}`, cause)
      }
      try {
        await this.adapter.rename(temp, path)
      } catch (cause) {
        try {
          await this.adapter.rename(backup, path)
        } catch {
          console.debug(`[abele-sync] ${path} is left at ${backup} until the next listing`)
          return false
        }
        throw new EngineError('io', `cannot write ${path}`, cause)
      }
      await this.dropQuietly(backup)
      return true
    } finally {
      inFlight.delete(backup)
    }
  }

  /**
   * The name the disk holds this file under, so a replacement keeps it: the engine may name a
   * file in another case than the disk's on a case-folding volume, and a rename onto that
   * spelling would respell the file. The file index answers for a note without a round trip;
   * a settings file, or a name the index spells otherwise, is looked up in its folder's listing,
   * where Obsidian spells every name composed.
   */
  async held(path: string): Promise<string> {
    if (this.deps.indexed(path)) return path
    const cut = path.lastIndexOf('/')
    let files: string[]
    try {
      files = (await this.adapter.list(cut === -1 ? '/' : path.slice(0, cut))).files
    } catch {
      return path
    }
    if (files.includes(path)) return path
    const key = caseKey(path)
    return files.find((held) => caseKey(held) === key) ?? path
  }

  /**
   * The new spelling of a name the disk would not respell in one go.
   *
   * POSIX lets `rename` between two names of one file do nothing at all, and some mounts take
   * it literally, so the file goes out to a name nothing holds and comes back under the
   * spelling that was asked for. A rename carries the whole file or none of it, but between the
   * two steps the file is at the aside name and nowhere else — so that name is a backup in the
   * write journal, and a crash between the steps is put back under `to` by the next listing.
   */
  async respell(
    from: string,
    to: string,
    spelledExactly: (path: string) => Promise<boolean | null>
  ): Promise<void> {
    const aside = await this.freeName(to, 'old')
    const entry = { target: to, backup: aside }
    this.deps.journal.add(entry)
    await this.holding(aside, async () => {
      // Out from `to`, not from `from`: on the disk this is for, both names answer to the one
      // file, and `to` is the one that is there whether the rename before this took or not.
      try {
        await this.adapter.rename(to, aside)
      } catch (cause) {
        this.deps.journal.drop(entry)
        throw new EngineError('conflict', `cannot spell ${from} as ${to}`, cause)
      }
      try {
        await this.adapter.rename(aside, to)
      } catch (cause) {
        // Back under the name it had, rather than leaving the vault holding an aside name. A
        // disk that will not do that either leaves it to the journal.
        try {
          await this.adapter.rename(aside, from)
          this.deps.journal.drop(entry)
        } catch {
          console.debug(`[abele-sync] ${from} is left at ${aside} until the next listing`)
        }
        throw new EngineError('conflict', `cannot spell ${from} as ${to}`, cause)
      }
      this.deps.journal.drop(entry)
    })
    if ((await spelledExactly(to)) === false) {
      throw new EngineError('conflict', `this disk keeps ${from} spelled as it was`)
    }
  }

  /**
   * Put back whatever a crash left half done, from the journal: a file found only at its
   * backup name goes back under its own; a backup beside a file that is there is the old copy
   * of a finished replacement and goes; a temp goes. An entry a step fails on stays for next
   * time. Entries this process is still working through are left alone.
   */
  async recover(): Promise<void> {
    for (const entry of this.deps.journal.entries()) {
      if (
        (entry.temp !== undefined && inFlight.has(entry.temp)) ||
        (entry.backup !== undefined && inFlight.has(entry.backup))
      ) {
        continue
      }
      try {
        if (entry.backup !== undefined && (await this.there(entry.backup))) {
          if (await this.there(entry.target)) await this.adapter.remove(entry.backup)
          else {
            await this.adapter.rename(entry.backup, entry.target)
            console.debug(`[abele-sync] put ${entry.target} back after an interrupted write`)
          }
        }
        if (entry.temp !== undefined && (await this.there(entry.temp))) {
          await this.adapter.remove(entry.temp)
        }
        this.deps.journal.drop(entry)
      } catch (error) {
        console.debug(`[abele-sync] could not finish tidying after ${entry.target}`, error)
      }
    }
  }

  /**
   * A free name beside `path` to write or step aside through. Short, and not built on the file's
   * own name: a segment may already be at the 255 bytes a filesystem allows.
   */
  async freeName(path: string, kind: 'tmp' | 'old'): Promise<string> {
    const cut = path.lastIndexOf('/')
    const folder = cut === -1 ? '' : path.slice(0, cut)
    for (let attempt = 0; attempt < 3; attempt++) {
      const stem = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
      const name = `.abele-sync-${stem}.${kind}`
      const candidate = folder === '' ? name : `${folder}/${name}`
      if (!inFlight.has(candidate) && !(await this.there(candidate))) return candidate
    }
    throw new EngineError('conflict', `no free name beside ${path} to write it through`)
  }

  /** Mark a name as this process's own while `run` is under way (the respell). */
  async holding<T>(name: string, run: () => Promise<T>): Promise<T> {
    inFlight.add(name)
    try {
      return await run()
    } finally {
      inFlight.delete(name)
    }
  }

  private async there(path: string): Promise<boolean> {
    try {
      return (await this.adapter.stat(path)) !== null
    } catch {
      return false
    }
  }

  private async dropQuietly(path: string): Promise<void> {
    try {
      if (await this.there(path)) await this.adapter.remove(path)
    } catch (error) {
      console.debug(`[abele-sync] left ${path} behind`, error)
    }
  }
}

/** The app as the vault's local storage, where the running plugin always has one. */
export function storageOf(app: App): LocalStorage | null {
  const held = app as unknown as Partial<LocalStorage>
  return typeof held.loadLocalStorage === 'function' && typeof held.saveLocalStorage === 'function'
    ? app
    : null
}

/**
 * The bytes as `writeBinary` takes them.
 *
 * The engine often holds a window onto a larger buffer, and only the window's own bytes may
 * be written; a view that is its whole buffer is passed through without copying it.
 */
export function bytesOf(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes
  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) return buffer
    return buffer.slice(byteOffset, byteOffset + byteLength)
  }
  const copy = new ArrayBuffer(byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}
