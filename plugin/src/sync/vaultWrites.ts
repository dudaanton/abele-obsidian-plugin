import { guardedVaultAdapter } from './vaultPathLinks'
import type { App, DataAdapter } from 'obsidian'
import { EngineError } from '@abele/sync-sdk/core'
import { caseKey } from '@abele/sync-sdk/protocol'
import type { LocalStorage } from './ledgerId'
import { WriteJournal, type JournalEntry } from './writeJournal'
import { sha256 } from './external/hash'
export { WriteJournal, JOURNAL_KEY, RECOVERED_WRITES_KEY, type JournalEntry } from './writeJournal'
import type { NativeFs } from './nativeVaultFs'
export { nativeOf, type NativeFs } from './nativeVaultFs'

/**
 * How the sync replaces a file in the vault without ever leaving half of one behind.
 *
 * The engine's `writeAtomic` asks for the old bytes or the new ones and nothing in between: a
 * short file is read by the next scan as an edit made here, and sent to every device (pi review
 * #1). `adapter.writeBinary` truncates the file and writes into it, so it cannot be used on the
 * file itself. The new bytes go to a private staging name instead, in full, and only then take the
 * file's name.
 *
 * Obsidian's `adapter.rename` refuses a name that is taken, on the desktop and on a phone alike
 * (`Destination file already exists!`), so how the name is taken depends on what is underneath:
 *
 * - **Desktop.** The adapter is Node's `fs` under a queue, and holds it as `fsPromises`;
 *   `getFullPath` maps a vault path to the disk's spelling. Final comparison and `rename(2)`
 *   run inside that same local-save queue. Unfenced native adapters instead preserve a backup
 *   and install exclusively (or hold if no safe capability exists).
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

/**
 * The temp names this process is using right now, whichever `ObsidianFileSystem` made them — a
 * second one (the join dialog counts files with its own) must not tidy away a live write.
 */
const inFlight = new Set<string>()
const reservedSources = new Set<string>()
/** Reserved before journal publication; released only after creation failure or stage retirement. */
export function reserveSourceStage(path: string): void {
  reservedSources.add(path)
}
export function releaseSourceStage(path: string): void {
  reservedSources.delete(path)
}
export function adapterWriteInFlight(path: string): boolean {
  return inFlight.has(path) || reservedSources.has(path)
}

/** `.abele-sync-<8>.tmp` holds new bytes (safe to drop); `.old` holds the only copy of a file. */
const TEMP_NAME = /^\.abele-sync-[a-z0-9]{8}\.(tmp|old)$/

/** Whether a path is one of the names this file writes through, so no listing reports it. */
export function isAdapterTemp(path: string): boolean {
  return TEMP_NAME.test(path.slice(path.lastIndexOf('/') + 1))
}

/** Whether it is a temp holding new bytes only, which a sweep may remove. */
export function isDroppableTemp(path: string): boolean {
  return isAdapterTemp(path) && path.endsWith('.tmp') && !adapterWriteInFlight(path)
}

/** What `VaultWriter` is handed by the file system that owns it. */
export interface WriterDeps {
  retainInstalled?: boolean
  published?(entry: JournalEntry): void
  stagingDirectory: string
  filesystem: DataAdapter
  native: NativeFs | null
  journal: WriteJournal
  /** Whether the vault's file index holds this exact path. */
  indexed(path: string): boolean
  /** Folders above `path` made. */
  makeParents(path: string): Promise<void>
  installed?(path: string): void
  fingerprint?(path: string): Promise<{ size: number; sha: string }>
  adoptReceipt?(from: string, to: string): Promise<void>
}

export class VaultWriter {
  constructor(private readonly deps: WriterDeps) {}

  private get disk(): DataAdapter {
    return guardedVaultAdapter(this.deps.filesystem)
  }

  /** Publish authenticated disk bytes without assembling either old or new contents. */
  async publishStage(entry: JournalEntry): Promise<void> {
    let notified = false
    const notify = () => {
      if (!notified) {
        notified = true
        this.deps.installed?.(entry.target)
      }
    }
    const stream = entry.streaming
    if (!entry.temp || !stream?.sealed || !this.deps.fingerprint)
      throw new EngineError('io', 'unsealed streaming stage')
    const matches = async (path: string, expected: { size: number; sha: string }) => {
      const actual = await this.deps.fingerprint(path)
      if (actual.size !== expected.size || actual.sha !== expected.sha)
        throw new EngineError('conflict', `${path} changed before publication`)
    }
    await matches(entry.temp, stream.sealed)
    const held = await this.held(entry.target)
    if (stream.base === null && !stream.retainBase) {
      await this.takeFreeName(entry.temp, entry.target)
    } else if (this.deps.native?.replaceFencedIdentity && !stream.retainBase) {
      await this.deps.native.replaceFencedIdentity(entry.temp, held, stream.base)
    } else {
      if (!stream.retainBase) await matches(held, stream.base)
      if (this.deps.native && !this.deps.native.installExclusive)
        throw new EngineError('io', 'native replacement has no safe publication capability')
      const backup = await this.freeName(held, 'old')
      const swapping: JournalEntry = {
        ...entry,
        target: held,
        backup,
        replacementSha: stream.sealed.sha,
        ...(this.deps.native || stream.retainBase ? { preserveBackup: true } : {}),
      }
      await this.deps.journal.persist(() => this.deps.journal.replace(entry, swapping))
      entry = swapping
      await this.holding(backup, async () => {
        if (this.deps.native) await this.deps.native.rename(held, backup)
        else await this.disk.rename(held, backup)
        await this.deps.adoptReceipt?.(held, backup)
        try {
          if (!stream.retainBase) await matches(backup, stream.base)
          if (this.deps.native) await this.deps.native.installExclusive(entry.temp, held)
          else await this.disk.rename(entry.temp, held)
        } catch (error) {
          try {
            if (this.deps.native) await this.deps.native.installExclusive(backup, held)
            else await this.disk.rename(backup, held)
            await this.deps.adoptReceipt?.(backup, held)
            await this.deps.journal.persist(() =>
              this.deps.journal.replace(entry, { ...entry, backup: undefined })
            )
          } catch {
            console.debug(
              `[abele-sync] ${held} is retained at ${backup} after stage publication failed`
            )
          }
          throw error
        }
        await this.deps.adoptReceipt?.(entry.temp, held)
        notify()
        const installed = { ...entry, installed: true }
        await this.deps.journal.persist(() => this.deps.journal.replace(entry, installed))
        entry = installed
        if (this.deps.native || stream.retainBase) {
          await this.preserveBackup(entry)
          await this.dropQuietly(entry.temp)
        } else await this.disk.remove(backup)
      })
    }
    await this.deps.adoptReceipt?.(entry.temp, entry.target)
    notify()
    await this.finishInstallation(entry)
  }

  private async finishInstallation(entry: JournalEntry): Promise<void> {
    // A whole-file intent already contains the authenticated replacement hash. A
    // consumed temp retains that intent until the ledger acknowledges publication;
    // writing another installed marker would add a third journal mutation per pull.
    if (this.deps.retainInstalled && !entry.streaming && !entry.backup) {
      this.deps.published?.(entry)
      return
    }
    await this.deps.journal.persist(() => {
      if (this.deps.retainInstalled)
        this.deps.journal.replace(entry, { ...entry, installed: true, backup: undefined })
      else this.deps.journal.drop(entry)
    })
  }

  /**
   * `bytes` at `path`, dated `mtime`, the old file or the new one at every instant. `exists` says
   * whether a file stands at `path` now, which decides between taking a free name and replacing.
   */
  async write(
    path: string,
    bytes: ArrayBuffer | Uint8Array,
    mtime: number,
    exists: boolean,
    before: ArrayBuffer | null
  ): Promise<void> {
    await this.deps.makeParents(path)
    const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
    const temp = await this.freeName(path, 'tmp')
    let entry: JournalEntry = { target: path, temp, replacementSha: await signature(bytes) }
    inFlight.add(temp)
    try {
      await this.deps.journal.persist(() => this.deps.journal.add(entry))
      try {
        // Mobile writeBinary base64-encodes its entire input. Keep each bridge
        // message bounded, while the journal-owned staging file remains hidden.
        const chunkSize = 1024 * 1024
        if (
          !this.deps.native &&
          typeof this.disk.appendBinary === 'function' &&
          bytes.byteLength > chunkSize
        ) {
          for (let at = 0; at < bytes.byteLength; at += chunkSize) {
            const chunk = bytesOf(view.slice(at, at + chunkSize))
            if (at === 0) await this.disk.writeBinary(temp, chunk, { mtime })
            else await this.disk.appendBinary(temp, chunk, { mtime })
          }
        } else await this.disk.writeBinary(temp, bytesOf(view), { mtime })
      } catch (cause) {
        throw new EngineError('io', `cannot write ${path}`, cause)
      }
      if (before !== null) await this.unchanged(path, before)
      if (!exists) {
        await this.takeFreeName(temp, path)
        this.deps.installed?.(path)
      } else if (this.deps.native?.replaceFenced) {
        await this.deps.native.replaceFenced(temp, await this.held(path), before)
        this.deps.installed?.(path)
      } else {
        const held = await this.held(path)
        const backup = await this.freeName(path, 'old')
        const swapping: JournalEntry = {
          target: held,
          temp,
          backup,
          replacementSha: entry.replacementSha,
          ...(this.deps.native !== null ? { preserveBackup: true } : {}),
        }
        await this.deps.journal.persist(() => this.deps.journal.replace(entry, swapping))
        entry = swapping
        if (this.deps.native !== null && !this.deps.native.installExclusive) {
          throw new EngineError(
            'io',
            'native replacement has no write fence or exclusive-install capability'
          )
        }
        if (!(await this.replaceBySwap(temp, held, backup, before, this.deps.native))) {
          // The old file could not be put back under its name: the entry stays for the next
          // listing, which tries again.
          await this.dropQuietly(temp)
          inFlight.delete(temp)
          throw new EngineError('io', `cannot write ${path}; ${held} is kept at ${backup}`)
        }
        this.deps.installed?.(path)
        const installed = { ...entry, installed: true }
        await this.deps.journal.persist(() => this.deps.journal.replace(entry, installed))
        entry = installed
        if (this.deps.native !== null) {
          // An unfenced adapter may have an open writer to the moved inode. Keep that copy
          // recoverable instead of claiming the original byte check excluded every writer.
          await this.preserveBackup(entry)
          await this.dropQuietly(temp)
        } else {
          await this.dropQuietly(backup)
          // A backup that would not be removed stays in the journal, for the next listing.
          if (await this.there(backup)) return
        }
      }
    } catch (error) {
      if (inFlight.has(temp)) {
        await this.dropQuietly(temp)
        if (
          !(await this.there(temp)) &&
          (entry.backup === undefined || !(await this.there(entry.backup)))
        )
          await this.deps.journal.persist(() => this.deps.journal.drop(entry))
      }
      throw error
    } finally {
      inFlight.delete(temp)
    }
    await this.finishInstallation(entry)
  }

  /** A file that was not there: the temp takes the name, which the adapter refuses if taken. */
  private async takeFreeName(temp: string, path: string): Promise<void> {
    try {
      await this.disk.rename(temp, path)
    } catch (cause) {
      // Somebody made the file in the moment since it was looked for. Theirs is not written over;
      // the puller holds the change and the next scan sends theirs.
      if (await this.there(path)) {
        throw new EngineError('conflict', `${path} is held by another file`, cause)
      }
      throw new EngineError('io', `cannot write ${path}`, cause)
    }
  }

  /**
   * Adapter swap: the old file to its backup name, the new one into its place —
   * written down in the journal first, so a crash between them is put back (`recover`). False
   * when the new file would not take the name and the old one would not go back under it either:
   * it is left at the backup name, for the next listing to put back.
   */
  private async replaceBySwap(
    temp: string,
    path: string,
    backup: string,
    before: ArrayBuffer | null,
    native: NativeFs | null
  ): Promise<boolean> {
    inFlight.add(backup)
    try {
      try {
        if (native) await native.rename(path, backup)
        else await this.disk.rename(path, backup)
      } catch (cause) {
        throw new EngineError('io', `cannot write ${path}`, cause)
      }
      try {
        if (before !== null) await this.unchanged(backup, before)
        if (native?.installExclusive) await native.installExclusive(temp, path)
        else await this.disk.rename(temp, path)
      } catch (cause) {
        try {
          if (native?.installExclusive) await native.installExclusive(backup, path)
          else await this.disk.rename(backup, path)
        } catch {
          console.debug(`[abele-sync] ${path} is left at ${backup} until the next listing`)
          return false
        }
        if (cause instanceof EngineError) throw cause
        throw new EngineError('io', `cannot write ${path}`, cause)
      }
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
      files = (await this.disk.list(cut === -1 ? '/' : path.slice(0, cut))).files
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
    await this.holding(aside, async () => {
      await this.deps.journal.persist(() => this.deps.journal.add(entry))
      // Out from `to`, not from `from`: on the disk this is for, both names answer to the one
      // file, and `to` is the one that is there whether the rename before this took or not.
      try {
        await this.disk.rename(to, aside)
      } catch (cause) {
        await this.deps.journal.persist(() => this.deps.journal.drop(entry))
        throw new EngineError('conflict', `cannot spell ${from} as ${to}`, cause)
      }
      try {
        await this.disk.rename(aside, to)
      } catch (cause) {
        // Back under the name it had, rather than leaving the vault holding an aside name. A
        // disk that will not do that either leaves it to the journal.
        try {
          await this.disk.rename(aside, from)
          await this.deps.journal.persist(() => this.deps.journal.drop(entry))
        } catch {
          console.debug(`[abele-sync] ${from} is left at ${aside} until the next listing`)
        }
        throw new EngineError('conflict', `cannot spell ${from} as ${to}`, cause)
      }
      await this.deps.journal.persist(() => this.deps.journal.drop(entry))
    })
    if ((await spelledExactly(to)) === false) {
      throw new EngineError('conflict', `this disk keeps ${from} spelled as it was`)
    }
  }

  /**
   * Put back whatever a crash left half done, from the journal: a file found only at its
   * backup name goes back under its own. A backup beside exact replacement bytes can go;
   * beside an independently edited target it is preserved with a durable locator instead.
   * A stale installed flag cannot authorize deletion. Temps go, active intents complete, and
   * scans resume. An entry an IO step fails on stays for retry; live writes are left alone.
   */
  async recover(): Promise<void> {
    if (this.deps.native?.archiveBackup) {
      for (const retained of await this.deps.journal.currentVaultRecovered()) {
        if (!(await this.deps.journal.currentProtects(retained.backup))) continue
        if (inFlight.has(retained.backup))
          throw new EngineError('io', 'scan held while a journalled replacement has a live backup')
        const archived = await this.deps.native.archiveBackup(retained.backup)
        await this.deps.journal.persist(() =>
          this.deps.journal.relocateRecovered(retained.backup, archived)
        )
      }
    }
    for (const entry of await this.deps.journal.currentEntries()) {
      if (!(await this.deps.journal.isCurrent(entry))) continue
      if (entry.retiredGeneration) continue
      if (
        this.deps.retainInstalled &&
        !entry.backup &&
        (entry.installed ||
          (!entry.streaming &&
            entry.replacementSha &&
            entry.temp &&
            !(await this.there(entry.temp))))
      )
        continue
      if (entry.streaming && !entry.backup) {
        if (!entry.disposableSource && !entry.target.startsWith('.abele-sync/placement-inbox/'))
          continue
        if (entry.temp && adapterWriteInFlight(entry.temp)) continue
        if (entry.temp && (await this.there(entry.temp))) {
          if (!(await this.deps.journal.isCurrent(entry))) continue
          await this.disk.remove(entry.temp)
        }
        await this.deps.journal.persist(() => this.deps.journal.drop(entry))
        console.debug('[abele-sync] retired interrupted disposable placement source')
        continue
      }
      if (entry.backup !== undefined && inFlight.has(entry.backup)) {
        throw new EngineError('io', 'scan held while a journalled replacement has a live backup')
      }
      if (
        (entry.temp !== undefined && inFlight.has(entry.temp)) ||
        (entry.backup !== undefined && inFlight.has(entry.backup))
      ) {
        continue
      }
      try {
        if (entry.backup && (await this.deps.journal.currentProtects(entry.backup)))
          await this.preserveBackup(entry)
        if (entry.backup !== undefined && (await this.there(entry.backup))) {
          if (await this.deps.journal.currentProtects(entry.backup)) {
            // A completed preservation decision outlives a later target edit/reversion/delete.
          } else if (await this.there(entry.target)) {
            // A restarted streaming publication has no live incremental receipt. Keep its
            // old bytes as recovery evidence without reading a potentially large target.
            const matchesReplacement =
              !entry.streaming &&
              entry.preserveBackup !== true &&
              entry.replacementSha !== undefined &&
              (this.deps.fingerprint
                ? (await this.deps.fingerprint(entry.target)).sha
                : await signature(await this.disk.readBinary(entry.target))) ===
                entry.replacementSha
            if (!(await this.deps.journal.isCurrent(entry))) continue
            if (
              matchesReplacement &&
              entry.preserveBackup !== true &&
              !(await this.deps.journal.currentProtects(entry.backup))
            )
              await this.disk.remove(entry.backup)
            else {
              // Do not overwrite the independent target or discard the old copy. Keep the
              // backup hidden (not a new uploadable identity), and persist its locator first.
              await this.preserveBackup(entry)
              console.debug(
                `[abele-sync] preserved previous bytes of ${entry.target} at ${entry.backup}; scanning can resume`
              )
            }
          } else {
            if (!(await this.deps.journal.isCurrent(entry))) continue
            await this.disk.rename(entry.backup, entry.target)
            console.debug(`[abele-sync] put ${entry.target} back after an interrupted write`)
          }
        }
        if (entry.temp !== undefined && (await this.there(entry.temp))) {
          if (!(await this.deps.journal.isCurrent(entry))) continue
          await this.disk.remove(entry.temp)
        }
        await this.deps.journal.persist(() => this.deps.journal.drop(entry))
      } catch (error) {
        throw new EngineError(
          'io',
          `cannot recover ${entry.target}; scan refused while a replacement is unfinished`,
          error
        )
      }
    }
  }

  /**
   * A free private name to write or step aside through. Short, and not built on the file's
   * own name: a segment may already be at the 255 bytes a filesystem allows.
   */
  async freeName(path: string, kind: 'tmp' | 'old'): Promise<string> {
    const folder = this.deps.stagingDirectory
    await this.deps.makeParents(`${folder}/placeholder`)
    for (let attempt = 0; attempt < 3; attempt++) {
      const stem = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
      const name = `.abele-sync-${stem}.${kind}`
      const candidate = folder === '' ? name : `${folder}/${name}`
      if (!adapterWriteInFlight(candidate) && !(await this.there(candidate))) return candidate
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
      return (await this.disk.stat(path)) !== null
    } catch (cause) {
      const code =
        typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : null
      if (code === 'ENOENT' || code === 'ENOTDIR') return false
      throw new EngineError('io', `cannot stat ${path}`, cause)
    }
  }

  private async unchanged(path: string, before: ArrayBuffer): Promise<void> {
    if (!(await this.there(path)))
      throw new EngineError('conflict', `${path} changed while its replacement was prepared`)
    const current = new Uint8Array(await this.disk.readBinary(path))
    const original = new Uint8Array(before)
    if (current.length !== original.length || current.some((value, at) => value !== original[at])) {
      throw new EngineError('conflict', `${path} changed while its replacement was prepared`)
    }
  }

  private async dropQuietly(path: string): Promise<void> {
    try {
      if (await this.there(path)) await this.disk.remove(path)
    } catch (error) {
      console.debug(`[abele-sync] left ${path} behind`, error)
    }
  }
  private async preserveBackup(entry: JournalEntry): Promise<void> {
    await this.deps.journal.persist(() => this.deps.journal.preserve(entry))
    if (entry.backup && this.deps.native?.archiveBackup) {
      const retained = await this.deps.native.archiveBackup(entry.backup)
      await this.deps.journal.persist(() =>
        this.deps.journal.relocateRecovered(entry.backup, retained)
      )
    }
  }
}

async function signature(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  return sha256(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
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
