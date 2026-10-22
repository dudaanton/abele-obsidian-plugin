import { guardedVaultAdapter } from './vaultPathLinks'
import type { App, DataAdapter } from 'obsidian'
import { EngineError } from '@abele/sync-sdk/core'
import { caseKey } from '@abele/sync-sdk/protocol'
import type { LocalStorage } from './ledgerId'
import { WriteJournal, type JournalEntry } from './writeJournal'
import { sha256 } from './external/hash'
export { WriteJournal, JOURNAL_KEY, RECOVERED_WRITES_KEY, type JournalEntry } from './writeJournal'
import type { NativeFs } from './nativeVaultFs'
import type { ConditionalFileOperation } from './conditionalFiles'
export { nativeOf, type NativeFs } from './nativeVaultFs'

/** Legacy publication delegates to the host conditional gate; recovery retains unproven backups. */

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
const TEMP_NAME =
  /^(?:\.abele-sync-[a-z0-9]{8}\.(?:tmp|old)|\.abele-receipt-[a-zA-Z0-9-]{1,128}\.tmp)$/

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
  conditionalFile(operation: ConditionalFileOperation): Promise<boolean>
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

  private receiptPath(receipt: string): string {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(receipt))
      throw new EngineError('protocol', 'invalid installation receipt')
    return this.deps.stagingDirectory + '/.abele-receipt-' + receipt + '.tmp'
  }

  /** An absent target needs no displaced-victim journal. The durable intent owns its data. */
  async publishAbsent(
    path: string,
    bytes: Uint8Array,
    mtime: number,
    receipt?: string
  ): Promise<boolean> {
    const id = receipt ?? crypto.randomUUID(),
      temp = this.receiptPath(id)
    if (inFlight.has(temp)) throw new EngineError('conflict', 'Installation receipt is active')
    inFlight.add(temp)
    try {
      const entry: JournalEntry = {
        target: path,
        temp,
        conditionalReceipt: id,
        replacementSha: await signature(bytes),
      }
      if (await this.deps.journal.currentEntry(temp))
        throw new EngineError('conflict', 'Installation receipt already has unfinished work')
      if (await this.there(temp))
        throw new EngineError('conflict', 'Installation path contains retained evidence')
      await this.deps.makeParents(path)
      await this.deps.makeParents(temp)
      await this.deps.journal.persist(() => this.deps.journal.add(entry))
      // This is an owned private path, never a public overwrite. Publication remains exclusive.
      const chunkSize = 1024 * 1024
      if (bytes.length > chunkSize && !this.deps.native) {
        for (let at = 0; at < bytes.length; at += chunkSize) {
          const chunk = bytesOf(bytes.slice(at, at + chunkSize))
          if (at === 0) await this.disk.writeBinary(temp, chunk, { mtime })
          else await this.disk.appendBinary(temp, chunk, { mtime })
        }
      } else await this.disk.writeBinary(temp, bytesOf(bytes), { mtime })
      if (this.deps.native) {
        if (!this.deps.native.syncPath || !this.deps.native.installExclusive)
          throw new EngineError('io', 'durable exclusive installation is unavailable')
        await this.deps.native.syncPath(temp)
      }
      try {
        if (this.deps.native) await this.deps.native.installExclusive(temp, path)
        else await this.disk.rename(temp, path)
      } catch (error) {
        // A lost acknowledgement is uncertain; keep the intent and data for proof/review.
        if ((await this.disk.stat(path)) !== null) return false
        throw error
      }
      if (this.deps.native) await this.deps.native.syncPath(path)
      this.deps.installed?.(path)
      if (!receipt) await this.discardReceipt(id)
      return true
    } finally {
      inFlight.delete(temp)
    }
  }

  async installedReceipt(receipt: string, path: string, sha: string): Promise<boolean | undefined> {
    const temp = this.receiptPath(receipt),
      entry = await this.deps.journal.currentEntry(temp)
    if (!entry?.conditionalReceipt) return undefined
    if (
      entry.target !== path ||
      entry.replacementSha !== sha ||
      !this.deps.native?.sameObject ||
      !this.deps.native.syncPath ||
      !this.deps.fingerprint
    )
      return false
    if (!(await this.there(temp)) || !(await this.there(path))) return false
    if (!(await this.deps.native.sameObject(temp, path))) return false
    if ((await this.deps.fingerprint(path)).sha !== sha) return false
    if (!(await this.deps.native.sameObject(temp, path))) return false
    await this.deps.native.syncPath(path)
    return true
  }

  async discardReceipt(receipt: string): Promise<boolean> {
    const temp = this.receiptPath(receipt),
      entry = await this.deps.journal.currentEntry(temp)
    if (!entry?.conditionalReceipt) return false
    if (await this.there(temp)) {
      await this.disk.remove(temp)
      if (this.deps.native) await this.deps.native.syncPath(temp, true)
    }
    await this.deps.journal.persist(() => this.deps.journal.drop(entry))
    return true
  }

  private async conditional(operation: ConditionalFileOperation): Promise<void> {
    console.debug('[abele-sync] conditional legacy effect', operation.path, operation.effect.kind)
    if (!(await this.deps.conditionalFile(operation)))
      throw new EngineError('conflict', 'File changed before legacy publication')
  }

  async publishStage(entry: JournalEntry): Promise<void> {
    console.debug('[abele-sync] publishing legacy stage', entry.target, entry.temp)
    if (!entry.temp || !entry.streaming?.sealed)
      throw new EngineError('io', 'unsealed streaming stage')
    const base = entry.streaming.base
    if (base && base.mtime === undefined)
      throw new EngineError('conflict', 'Stage has no authorized modification time')
    await this.conditional({
      path: entry.target,
      expected: base ? { ...base, mtime: base.mtime } : null,
      effect: { kind: 'install', stageId: entry.temp },
    })
    this.deps.installed?.(entry.target)
    await this.finishInstallation(entry)
  }

  async write(
    path: string,
    bytes: ArrayBuffer | Uint8Array,
    mtime: number,
    exists: boolean,
    before: ArrayBuffer | null
  ): Promise<void> {
    console.debug('[abele-sync] publishing legacy bytes', path)
    const stat = exists ? await this.disk.stat(path) : null
    if (exists && (!stat || stat.type !== 'file' || before === null))
      throw new EngineError('conflict', 'Legacy replacement has no authorized base')
    await this.conditional({
      path,
      expected:
        stat && before
          ? {
              size: before.byteLength,
              mtime: Math.round(stat.mtime),
              sha: await signature(before),
            }
          : null,
      effect: {
        kind: 'write',
        bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        mtime,
      },
    })
    this.deps.installed?.(path)
  }

  async respell(
    from: string,
    to: string,
    spelledExactly: (path: string) => Promise<boolean | null>
  ): Promise<void> {
    console.debug('[abele-sync] respelling legacy file', from, to)
    const stat = await this.disk.stat(from)
    if (!stat || stat.type !== 'file' || !this.deps.fingerprint)
      throw new EngineError('conflict', 'Legacy move has no authorized base')
    const have = await this.deps.fingerprint(from)
    await this.conditional({
      path: from,
      expected: { ...have, mtime: Math.round(stat.mtime) },
      effect: { kind: 'move', to },
    })
    if ((await spelledExactly(to)) === false)
      throw new EngineError('conflict', `this disk keeps ${from} spelled as it was`)
  }

  private get disk(): DataAdapter {
    return guardedVaultAdapter(this.deps.filesystem)
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
      if (entry.conditionalReceipt) continue // Owned by SDK receipt recovery, not legacy replay.
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
            // A legacy backup has no captured-base proof. Matching replacement
            // bytes do not authorize deleting a possibly newer private victim.
            await this.preserveBackup(entry)
            console.debug(
              `[abele-sync] preserved previous bytes of ${entry.target} at ${entry.backup}; scanning can resume`
            )
          } else {
            if (!(await this.deps.journal.isCurrent(entry))) continue
            const stat = await this.disk.stat(entry.backup)
            if (!stat || stat.type !== 'file' || !this.deps.fingerprint)
              throw new EngineError('io', 'Legacy backup has no authorized file identity')
            const have = await this.deps.fingerprint(entry.backup)
            await this.conditional({
              path: entry.backup,
              expected: { ...have, mtime: Math.round(stat.mtime) },
              effect: { kind: 'move', to: entry.target },
            })
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
