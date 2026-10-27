import { PRIVATE_REMOVAL_FILES, privateRemovalFileSystem } from './privateRemovalFileSystem'
import { inspectedAbsent, invalidateInspectedAbsence } from './inspectionDirectories'
import { SyncTaskBudget } from './syncTaskBudget'
import { directEntryDurability } from './directEntryDurability'
import { INSTALL_BATCH, nativeInstallBatch, type InstallItem } from './nativeInstallBatch'
import { PORTABLE_CANDIDATES } from './ledgerPathCandidates'
import { guardedVaultAdapter, mutationCheckedAdapter, vaultDisk } from './vaultPathLinks'
import {
  withMetadataInventory,
  invalidateMetadataInventory,
  verifyMetadataInventory,
} from './vaultPathLinks'
import { vaultPathKey } from './vaultPathLinks'
import type { ConditionalFileHost } from './conditionalFiles'
import { FINGERPRINT_UPLOAD, UPLOAD_READ, MOBILE_WHOLE_READ_MAX } from './mobileWholeRead'
import { privatePlacementStages, PRIVATE_PLACEMENT_STAGES } from './privatePlacementStages'
import { isDeviceLocalPluginState } from './deviceLocalState'
import { isHidden, isWireConfigDir } from './scope'
import { durableHostOf } from './hostSyncStorage'
import { MemoryRetention, type RetentionIndex } from './retentionIndex'
import { retainedFileStat } from './vaultPathLinks'
import {
  nativeChunkPort,
  connectionFilePort,
  vaultPathIsLink,
  checkedVaultPort,
} from './vaultPathLinks'
import {
  connectionPrivateRoot,
  privateDownload,
  withinRoot,
  CONNECTION_ROOT_SYMLINK,
} from './connectionPaths'
import { assertPhysicalPath } from './external/projection'
import { crossesSymlink } from './symlinkChain'
import { sha256 } from './external/hash'
import type { App, DataAdapter, ListedFiles, Stat } from 'obsidian'
import { TFile, TFolder, Platform } from 'obsidian'
import { unsupportedSyncName } from './platformSyncNames'
import {
  EngineError,
  SyncCancelled,
  MAX_CHUNK_BYTES,
  readReconciliation,
  requestReconciliation,
  type FileInfo,
  type FileSystem,
  type StateStore,
  type StateEntry,
  type AtomicStage,
  type ContentIdentity,
  type ChunkSource,
  type SourceStamp,
} from '@abele/sync-sdk/core'
import { BoundedVaultIo } from './boundedVaultIo'
import { ConditionalFiles, type ConditionalFileOperation } from './conditionalFiles'
import type { JournalEntry } from './writeJournal'
import { watchVault } from './vaultWatcher'
import { fencedPort, type RuntimeFence } from './external/recovery'
import { stagingDirectory } from './stagingDirectory'
import { externalCoordinationOf } from './external/ObsidianExternalFileHost'
import type { ExternalFileCoordination } from './external/coordination'
import { folderMutations } from './folderMutations'
import { adapterConfigRevision, observeAdapterConfig } from './adapterConfigChanges'
import { pathCoordinatorOf } from './pathCoordinator'
import type { LocalStorage } from './ledgerId'
import { makeParents } from './vaultFolders'
import { VaultDirectories } from './vaultDirectories'
import {
  isAdapterTemp,
  adapterWriteInFlight,
  isDroppableTemp,
  nativeOf,
  storageOf,
  VaultWriter,
  WriteJournal,
  reserveSourceStage,
  releaseSourceStage,
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
const INVENTORY_READ_ATTEMPTS = 3

/**
 * The vault's ignore file. It lives at the root rather than under the config folder, and a
 * leading dot keeps it out of Obsidian's file index, so nothing but this poll would ever
 * notice it being edited.
 */
const IGNORE_FILE = '.abele-sync-ignore'
const stageOperations = new WeakMap<object, Set<string>>()
const conditionalOperations = new WeakMap<object, Set<string>>()
const retentionCaches = new WeakMap<object, Map<string, RetentionIndex>>()
export const RETENTION_IDLE = Symbol.for('abele.sync.retention-idle-v1')
type DirectoryInfo = { path: string; identity: string; mtime: number }
type InventoryChild = { path: string; kind: 'file' | 'directory'; identity?: string }
async function readConditionalRecord(disk: DataAdapter, io: BoundedVaultIo, path: string) {
  const native = nativeChunkPort(disk)
  if (!native.open || !native.fullPath) return new Uint8Array(await disk.readBinary(path))
  const source = await io.openRead(path)
  try {
    if (source.size > MAX_CHUNK_BYTES)
      throw new EngineError('io', 'Conditional metadata exceeds one transfer chunk')
    const bytes = await source.read(0, source.size)
    await source.assertUnchanged()
    return bytes
  } finally {
    await source.close()
  }
}
/** Revisions belong to reads, never to a later consumer of a cached value. */
class InventoryCache<T> extends Map<string, T> {
  private readonly revisions = new Map<string, number>()
  constructor(private readonly revision: (path: string) => number) {
    super()
  }
  override get(path: string): T | undefined {
    return this.revisions.get(path) === this.revision(path) ? super.get(path) : undefined
  }
  override has(path: string): boolean {
    return this.get(path) !== undefined
  }
  wasRead(path: string): boolean {
    // Once a directory needed disk discovery, an expired observation must re-read
    // disk rather than fall back to an index which may not contain adapter writes.
    return super.has(path)
  }
  override set(path: string, value: T): this {
    this.revisions.set(path, this.revision(path))
    return super.set(path, value)
  }
  observe(path: string, read: () => T): T {
    const revision = this.revision(path)
    const value = read()
    this.revisions.set(path, revision)
    super.set(path, value)
    return value
  }
  retain(path: string, value: T): void {
    if (super.get(path) === value) this.revisions.set(path, this.revision(path))
  }
  async stable(path: string, read: () => T): Promise<Awaited<T>> {
    for (let attempt = 0; attempt < INVENTORY_READ_ATTEMPTS; attempt++) {
      const value = this.get(path) ?? this.observe(path, read)
      const revision = this.revisions.get(path)
      const result = await value
      if (revision === this.revision(path)) return result
    }
    // An unstable snapshot proves neither presence nor absence. Stop this pass
    // before adoption or download can act on it; a later pass can retry.
    throw new EngineError('io', 'Directory inventory kept changing; retry sync later')
  }
  override delete(path: string): boolean {
    this.revisions.delete(path)
    return super.delete(path)
  }
  override clear(): void {
    this.revisions.clear()
    super.clear()
  }
}
class InventoryProofs extends Set<string> {
  private readonly revisions = new Map<string, number>()
  constructor(private readonly revision: (path: string) => number) {
    super()
  }
  override has(path: string): boolean {
    return this.revisions.get(path) === this.revision(path) && super.has(path)
  }
  override add(path: string): this {
    this.revisions.set(path, this.revision(path))
    return super.add(path)
  }
  [Symbol.for('abele.sync.parent-proof-v1')](path: string): () => void {
    const revision = this.revision(path)
    return () => {
      this.revisions.set(path, revision)
      super.add(path)
    }
  }
}
interface InventoryPass {
  ledgerRows?: { revision: unknown; rows: StateEntry[] }
  indexedNames?: InventoryCache<Set<string>>
  parentFolders?: Set<string>
  publishedParents?: Set<string>
  directories?: Promise<DirectoryInfo[]>
  listings: InventoryCache<Promise<ListedFiles>>
  stats: InventoryCache<Promise<Stat | null>>
  mutations: Set<string>
  localChanges: Map<string, number>
  directoryChanges: Map<string, number>
  localRevision: number
  pollRevision: number
  configRevision: number
  children: InventoryCache<Promise<InventoryChild[]>>
  indexedChildren: InventoryCache<Promise<InventoryChild[]>>
  directoryStamp?: string
  directoryRevision: number
  /** Distinguishes passes; per-path revisions restart at zero in each one. */
  id: number
}
let inventoryIds = 0
let watchEpochs = 0
/** How long watcher coverage alone may stand in for a fresh look, as for a skipped scan. */
const WATCH_PROOF_MS = 300_000
const INVENTORY_PASS = Symbol.for('abele.sync.inventory-pass-v1')
const INVENTORY_DIRECTORIES = Symbol.for('abele.sync.inventory-directories-v1')
const normalizationPossible = (path: string) =>
  path !== path.normalize('NFC') || path.normalize('NFD') !== path

export interface ObsidianFileSystemOptions {
  adapter?: DataAdapter
  connectionId?: string
  journalOwner?: string
  diagnostic?: (
    operation: string,
    startedAt: number,
    outcome: string,
    paths?: readonly string[]
  ) => void
  /** Ordinary enumeration is bounded before representation inspection for folder tokens. */
  fileScope?: string | (() => string | undefined)
  /** Omitted for personal/root connections. Group roots are empty; members are exact paths. */
  discovery?: { roots: readonly string[]; includes(path: string): boolean }
  startupInventory?: () => ReadonlyMap<string, FileInfo> | undefined
  preserveEmptyDirectories?: boolean
  /** The startup/ownership fence, owned by the engine host. */
  runtimeFence?: RuntimeFence
  /** Durable restrictive provenance, completed before native bytes or paths change. */
  beforeEngineMutation?: (paths: string[]) => Promise<void>

  /** Ledger paths absent from the index are checked on disk before a scan calls them deleted. */
  ledger?: Pick<StateStore, 'all'> & {
    readCommittedEntries?(paths: readonly string[]): Promise<StateEntry[]>
  }
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
 * Raw adapter listings retain physical aliases the file index can hide. Exact indexed
 * spellings still supply size and mtime without a stat per file. Configuration files are
 * walked separately. Reads and writes also use the adapter: the index has no bytes, and
 * vault text reads would not preserve binary content.
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
  private readonly promotedInstallations = new WeakSet<object>()
  readonly [PORTABLE_CANDIDATES] = true
  get [INSTALL_BATCH]() {
    const native = this.native
    return native?.syncFile && native.syncPath && native.installExclusive && native.sameObject
      ? this.installBatch.bind(this)
      : undefined
  }
  private async installBatch<T>(
    items: readonly InstallItem[],
    work: (fs: FileSystem, flush: () => Promise<void>) => Promise<T>
  ): Promise<T | undefined> {
    const native = this.native
    if (!native) return Promise.resolve(undefined)
    // Publishing a sibling does not mutate an existing file. Actual parent creation is
    // fenced by makeParents; fencing every ancestor here invalidated all earlier siblings.
    const paths = items.map((item) => item.path)
    // Include only parents this cohort may create. Their invalidation shares the cohort's
    // durability transaction; existing parents must not retire installed siblings.
    const parents = new Set(
      items.map((item) => folderOf(item.path).replace(/^\/$/, '')).filter(Boolean)
    )
    for (const parent of parents) if ((await this.rawStat(parent)) === null) paths.push(parent)
    const installed: InstallItem[] = []
    let release!: () => void
    const receiptsReady = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending: (() => void)[] = []
    const local = storageOf(this.app)
    const host = local ? durableHostOf(local) : undefined
    const batch = this.withScanMutation(paths, () =>
      nativeInstallBatch(
        {
          fs: this,
          disk: this.disk,
          native,
          io: this.io,
          journal: this.journal,
          freeName: (path) => this.writer.freeName(path, 'tmp'),
          ownsStage: (path) =>
            isAdapterTemp(path) &&
            (!this.privateRoot ||
              withinRoot(path, stagingDirectory(this.configDir, this.privateRoot))),
          assertReady: () => this.runtimeFence?.assertReady(),
          validate: (path) => this.validateConditionalPath(path),
          parents: (path) => this.makeParents(path),
          publish: async (from, to, signal) => {
            const release = this.externalCoordination.beginEngineMutation([to])
            try {
              await this.beforeEngineMutation?.([to])
              signal?.throwIfAborted()
              this.runtimeFence?.assertReady()
              await native.installExclusive(from, to)
            } finally {
              release()
            }
          },
          installed: (item) => {
            if (host)
              pending.push(host.deferScanInstallation(this.pathKey(item.path), receiptsReady))
            this.writtenStat = { path: item.path, size: item.size, mtime: item.mtime }
            this.awaitingIndex.add(item.path)
            this.wrote([item.path], 'file')
            installed.push(item)
          },
        },
        items,
        work
      )
    )
    return batch
      .then(async (result) => {
        if (result !== undefined) await this.rememberInstalled(installed)
        return result
      })
      .finally(() => {
        for (const clear of pending) clear()
        release()
      })
  }
  /** Hashes a batch verified before publishing, by what each installed file is right after its
   * ledger commit. The watcher's own-write check fingerprints every installed file; without
   * this it read each one back. Receipts live until examined, not until an arbitrary file
   * count; a watcher may collect a whole pull before its debounce expires. Mutations retire
   * affected receipts before and after the write; identity and timestamps are checked too. */
  private async rememberInstalled(items: readonly InstallItem[]): Promise<void> {
    const local = storageOf(this.app)
    const host = local ? durableHostOf(local) : undefined
    if (!host || !this.fileIdentity) return
    for (const item of items) {
      if (!this.cacheableScanPath(item.path)) continue
      const key = this.pathKey(item.path)
      const revision = host.scanFingerprintRevision(key)
      const watched = this.watchPathRevision(key)
      const contentRevision = await nativeOf(this.disk)?.fileContentRevision?.(item.path)
      const identity = await this.fileIdentity(item.path)
      const stat = await this.rawStat(item.path)
      if (
        !identity ||
        stat?.type !== 'file' ||
        stat.size !== item.size ||
        stamp(stat.mtime) !== item.mtime ||
        (contentRevision
          ? contentRevision !== (await nativeOf(this.disk)?.fileContentRevision?.(item.path))
          : watched !== this.watchPathRevision(key))
      )
        continue
      host.rememberScanInstallation(
        key,
        {
          identity,
          size: stat.size,
          mtime: stat.mtime,
          ctime: stat.ctime,
          sha: item.sha,
          ...(contentRevision ? { contentRevision } : {}),
        },
        revision
      )
    }
  }
  readonly fileIdentity?: (path: string) => Promise<string | null>
  private readonly diagnostic?: ObsidianFileSystemOptions['diagnostic']
  private readonly fileScope?: ObsidianFileSystemOptions['fileScope']
  private inventory: InventoryPass | null = null
  private inventoryDepth = 0
  private writtenStat: FileInfo | null = null
  private indexProbe = 0
  private indexFallback = false
  private layoutReady = false

  private indexReady(): boolean {
    const cache = this.app.metadataCache as typeof this.app.metadataCache & {
      initialized?: boolean
      isCacheClean?: () => boolean
    }
    if (
      (this.app.workspace?.layoutReady ?? this.layoutReady) !== true ||
      cache?.initialized === false
    )
      this.indexFallback = true
    try {
      const clean = cache?.isCacheClean?.()
      if (clean !== true) this.indexFallback = true
      return !this.indexFallback
    } catch {
      this.indexFallback = true
      return false
    }
  }

  async [Symbol.for('abele.sync.index-absent-v1')](path: string): Promise<boolean> {
    this.runtimeFence?.assertReady()
    // This is a preflight hint, never permission to publish. The raw target check
    // under the placement lease still protects files that have not reached the index.
    if (
      this.indexReady() === false ||
      !this.inventory ||
      this.awaitingIndex.has(path) ||
      this.inventory.mutations.has(path)
    )
      return false
    if (this.app.vault.getAbstractFileByPath(path)) return false
    const parent = this.app.vault.getAbstractFileByPath(folderOf(path))
    if (!(parent instanceof TFolder)) return false
    const inventory = this.inventory
    const cache = (inventory.indexedNames ??= new InventoryCache((path) =>
      this.inventoryRevision(path, inventory)
    ))
    let names = cache.get(parent.path)
    if (names === undefined) {
      names = cache.observe(
        parent.path,
        () => new Set(parent.children.map((child) => this.pathKey(child.path)))
      )
    }
    return !names.has(this.pathKey(path))
  }

  async [Symbol.for('abele.sync.written-stat-v1')](
    path: string,
    wrote: { size: number; mtime: number }
  ) {
    const receipt = this.writtenStat
    this.writtenStat = null
    return receipt?.path === path && receipt.size === wrote.size && receipt.mtime === wrote.mtime
      ? { size: receipt.size, mtime: receipt.mtime }
      : null
  }
  // Connection-local metadata proof; root/ancestor events retire it before reuse.
  private rootChain: { root: string; linked: Promise<boolean> } | undefined

  private invalidateRootChain(paths: readonly string[]): void {
    const root = this.scopedRoot()
    if (root && paths.some((path) => path === root || root.startsWith(path + '/')))
      this.rootChain = undefined
  }

  async [INVENTORY_PASS]<T>(work: () => Promise<T>): Promise<T> {
    return withMetadataInventory(this.app.vault, async () => {
      this.directories.beginInventory()
      try {
        return await this.inventoryPass(work)
      } finally {
        this.directories.endInventory()
      }
    })
  }
  [Symbol.for('abele.sync.verify-inventory-root-v1')](): Promise<void> {
    return verifyMetadataInventory(this.app.vault)
  }
  private async inventoryPass<T>(work: () => Promise<T>): Promise<T> {
    if (this.inventoryDepth === 0) {
      this.indexFallback = false
      this.indexReady()
    }
    // Shared filesystem instances may have overlapping engines. Never share their snapshots.
    this.inventory = ++this.inventoryDepth === 1 ? this.createInventory() : null
    const inventory = this.inventory
    const recordChange = (path: string) => {
      invalidateMetadataInventory(this.app.vault)
      if (inventory) this.recordInventoryChange(inventory, path)
    }
    const invalidate = (
      file: { path: string; children?: unknown[] },
      previous?: string,
      created = false
    ) => {
      invalidateMetadataInventory(this.app.vault)
      this.directories.invalidateInventory()
      this.invalidateRootChain([file.path, ...(previous ? [previous] : [])])
      if (!inventory) return
      for (const path of [file.path, ...(previous ? [previous] : [])]) {
        recordChange(path)
        for (const parent of inventory.parentFolders ?? [])
          if (parent === path || parent.startsWith(path + '/'))
            inventory.parentFolders?.delete(parent)
        if (created && inventory.mutations.has(path)) {
          if (file.children) inventory.mutations.delete(path)
          continue
        }
        inventory.indexedNames?.delete(folderOf(path).replace(/^\/$/, ''))
        for (const parent of inventory.indexedNames?.keys() ?? [])
          if (parent === path || parent.startsWith(path + '/'))
            inventory.indexedNames?.delete(parent)
        for (const cache of [inventory.listings, inventory.children, inventory.indexedChildren]) {
          cache.delete(folderOf(path).replace(/^\/$/, ''))
          for (const key of cache.keys())
            if (key === path || (file.children && key.startsWith(path + '/'))) cache.delete(key)
        }
        if (file.children) {
          inventory.directoryRevision++
          inventory.directories = undefined
          for (const parent of inventory.publishedParents ?? [])
            if (parent === path || parent.startsWith(path + '/'))
              inventory.publishedParents?.delete(parent)
        }
      }
    }
    const refs = [
      this.app.vault.on('create', (file) => invalidate(file, undefined, true)),
      this.app.vault.on('modify', (file) => {
        if (inventory) this.recordInventoryChange(inventory, file.path, false)
      }),
      this.app.vault.on('delete', (file) => invalidate(file)),
      this.app.vault.on('rename', (file, previous) => invalidate(file, previous)),
    ]
    const stopConfig = observeAdapterConfig(
      this.scopedAdapter,
      this.configDir,
      (paths, directory) => {
        if (!inventory) return
        for (const path of paths) {
          recordChange(path)
          for (const parent of inventory.publishedParents ?? [])
            if (parent === path || parent.startsWith(path + '/'))
              inventory.publishedParents?.delete(parent)
        }
        inventory.configRevision = this.configRevision()
        if (directory && paths.some((path) => !isDeviceLocalPluginState(path, this.configDir)))
          inventory.directoryRevision++
      }
    )
    try {
      return await work()
    } finally {
      try {
        await this.settleInventoryParents()
        await inventory?.directories
        await Promise.all([
          ...(inventory?.listings.values() ?? []),
          ...(inventory?.children.values() ?? []),
          ...(inventory?.indexedChildren.values() ?? []),
        ])
      } finally {
        for (const ref of refs) this.app.vault.offref(ref)
        stopConfig()
        this.inventoryDepth--
        this.inventory = null
        if (this.inventoryDepth === 0) this.indexFallback = false
      }
    }
  }
  private operationStats?: { revision: number; cache: Map<string, Promise<Stat | null>> }
  private operationDepth = 0
  private readonly operationRevision: () => number
  async [Symbol.for('abele.sync.operation-pass-v1')]<T>(work: () => Promise<T>): Promise<T> {
    if (this.inventoryDepth) return work()
    this.operationStats =
      ++this.operationDepth === 1
        ? { revision: this.operationRevision(), cache: new Map() }
        : undefined
    try {
      return await withMetadataInventory(this.app.vault, work)
    } finally {
      this.operationStats = undefined
      this.operationDepth--
    }
  }
  private createInventory(): InventoryPass {
    const cache = <T>() => new InventoryCache<T>((path) => this.inventoryRevision(path, inventory))
    const inventory: InventoryPass = {
      listings: cache(),
      stats: cache(),
      mutations: new Set(),
      localChanges: new Map(),
      directoryChanges: new Map(),
      localRevision: 0,
      pollRevision: 0,
      directoryRevision: 0,
      id: ++inventoryIds,
      configRevision: this.configRevision(),
      children: cache(),
      indexedChildren: cache(),
    }
    return inventory
  }
  /** The current inventory pass, if any. Its per-path revisions are comparable only within it. */
  [Symbol.for('abele.sync.inventory-id-v1')](): number | undefined {
    return this.inventory?.id
  }
  [Symbol.for('abele.sync.local-change-revision-v1')](path?: string): number | undefined {
    if (!this.inventory) return undefined
    this.syncInventoryConfig(this.inventory)
    if (path === undefined) return this.inventory.localRevision
    return this.pathRevision(path, this.inventory)
  }
  private recordInventoryChange(inventory: InventoryPass, path: string, membership = true): void {
    invalidateMetadataInventory(this.app.vault)
    const revision = ++inventory.localRevision
    inventory.localChanges.set(this.pathKey(path), revision)
    if (membership)
      inventory.directoryChanges.set(this.pathKey(folderOf(path).replace(/^\/$/, '')), revision)
  }
  private syncInventoryConfig(inventory: InventoryPass): void {
    // Config adapter writes have no vault event. Fold their free counter into the
    // same clock so cached observations and per-path revisions remain comparable.
    const configRevision = this.configRevision()
    if (inventory.configRevision !== configRevision) {
      inventory.configRevision = configRevision
      inventory.localChanges.set(this.pathKey(this.configDir), ++inventory.localRevision)
      inventory.directoryRevision++
    }
  }
  private pathRevision(path: string, inventory: InventoryPass): number {
    let revision = inventory.pollRevision
    // Ancestor renames/deletions also invalidate observations of their children.
    for (
      let current = this.pathKey(path);
      current;
      current = current.slice(0, current.lastIndexOf('/'))
    ) {
      revision = Math.max(revision, inventory.localChanges.get(current) ?? 0)
      if (!current.includes('/')) break
    }
    return revision
  }
  private inventoryRevision(path: string, inventory = this.inventory): number {
    if (!inventory) return 0
    this.syncInventoryConfig(inventory)
    return Math.max(
      this.pathRevision(path, inventory),
      inventory.directoryChanges.get(this.pathKey(path)) ?? 0
    )
  }
  private parentRevision(path: string, inventory: InventoryPass): number {
    this.syncInventoryConfig(inventory)
    return this.pathRevision(path, inventory)
  }
  async [INVENTORY_DIRECTORIES](settle = false): Promise<DirectoryInfo[]> {
    if (settle) await this.settleInventoryParents()
    const read = async () => {
      const result = []
      for await (const directory of this.listDirectories()) result.push(directory)
      return result
    }
    if (!this.inventory) return read()
    const inventory = this.inventory
    for (let attempt = 0; attempt < INVENTORY_READ_ATTEMPTS; attempt++) {
      this.syncInventoryConfig(inventory)
      const revision = `${inventory.directoryRevision}`
      if (inventory.directories === undefined || inventory.directoryStamp !== revision) {
        inventory.directoryStamp = revision
        inventory.directories = read()
      }
      const directories = await inventory.directories
      this.syncInventoryConfig(inventory)
      if (revision === `${inventory.directoryRevision}`) return directories
      inventory.directories = undefined
    }
    throw new EngineError('io', 'Directory inventory kept changing; retry sync later')
  }
  async [Symbol.for('abele.sync.inventory-children-v1')](
    parent: string,
    target: string,
    filesOnly = false
  ): Promise<InventoryChild[]> {
    if (parent && !this.inventoryVisible(parent)) return []
    const inventory = this.inventory
    if (
      !this.indexReady() ||
      !inventory ||
      normalizationPossible(target) ||
      inventory.listings.wasRead(parent)
    )
      return this.listChildren(parent)
    const read = async () => {
      // Download preflight needs only file membership, not directory identities.
      // Do not populate the full placement inventory with this narrower snapshot.
      const indexedOnly = filesOnly && !target.split('/').some((part) => part.startsWith('.'))
      const directories = indexedOnly ? [] : await this[INVENTORY_DIRECTORIES]()
      // Discovery may itself have revealed a Unicode alias at this parent.
      if (inventory.listings.wasRead(parent)) return this.listChildren(parent)
      const node = (
        parent === '' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(parent)
      ) as {
        children?: { path: string; children?: unknown[] }[]
      } | null
      const files = new Set(
        (node?.children ?? []).filter((one) => !one.children).map((one) => one.path)
      )
      // Indexed siblings already prove membership. Only watcher-lagged names need I/O.
      for (const path of this.awaitingIndex)
        if (
          !files.has(path) &&
          folderOf(path).replace(/^\/$/, '') === parent &&
          (await this.rawStat(path))?.type === 'file'
        )
          files.add(path)
      return [
        ...[...files].map((path) => ({ path, kind: 'file' as const })),
        ...(await Promise.all(
          [...(inventory.publishedParents ?? [])]
            .filter(
              (path) =>
                folderOf(path).replace(/^\/$/, '') === parent &&
                !directories.some((one) => one.path === path)
            )
            .map(async (path) => ({
              path,
              kind: 'directory' as const,
              identity: await this.directories.identity(path, true),
            }))
        )),
        ...directories
          .filter((one) => folderOf(one.path).replace(/^\/$/, '') === parent)
          .map((one) => ({ path: one.path, kind: 'directory' as const, identity: one.identity })),
      ]
    }
    const children = filesOnly ? await read() : await inventory.indexedChildren.stable(parent, read)
    return children.filter((one) => this.inventoryVisible(one.path)).map((one) => ({ ...one }))
  }
  private inventoryListing(parent: string): Promise<ListedFiles> {
    const inventory = this.inventory
    const read = () =>
      this.disk.list(parent).catch(async (error): Promise<ListedFiles> => {
        if (notFound(error) || (await this.rawStat(parent)) === null)
          return { files: [], folders: [] }
        inventory?.listings.delete(parent)
        throw error
      })
    return inventory ? inventory.listings.stable(parent, read) : read()
  }
  private updateInventory(
    paths: readonly string[],
    known?: 'file' | 'folder' | null,
    membershipOnly = false
  ): void {
    const inventory = this.inventory
    if (!inventory) return
    for (const path of paths) {
      const parent = folderOf(path) === '/' ? '' : folderOf(path)
      const changed = () => {
        if (membershipOnly)
          inventory.directoryChanges.set(this.pathKey(parent), ++inventory.localRevision)
        else this.recordInventoryChange(inventory, path)
      }
      const retain: (() => void)[] = []
      const names = known === 'file' ? inventory.indexedNames?.get(parent) : undefined
      if (names) {
        names.add(this.pathKey(path))
        retain.push(() => inventory.indexedNames?.retain(parent, names))
      } else inventory.indexedNames?.delete(parent)
      if (
        !inventory.children.has(parent) &&
        !inventory.indexedChildren.has(parent) &&
        !inventory.listings.has(parent)
      ) {
        changed()
        for (const refresh of retain) refresh()
        continue
      }
      const stat =
        known === undefined
          ? this.rawStat(path)
          : Promise.resolve(known === null ? null : { type: known })
      for (const cache of [inventory.children, inventory.indexedChildren]) {
        const children = cache.get(parent)
        if (children !== undefined) {
          cache.set(
            parent,
            Promise.all([children, stat]).then(async ([rows, standing]) => [
              ...rows.filter((one) => one.path !== path),
              ...(standing?.type === 'file'
                ? [{ path, kind: 'file' as const }]
                : standing?.type === 'folder'
                  ? [
                      {
                        path,
                        kind: 'directory' as const,
                        identity: await this.directories.identity(path, true),
                      },
                    ]
                  : []),
            ])
          )
          const patched = cache.get(parent)
          retain.push(() => cache.retain(parent, patched))
        }
      }
      const prior = inventory.listings.get(parent)
      if (prior !== undefined) {
        inventory.listings.set(
          parent,
          Promise.all([prior, stat]).then(([listing, stat]) => ({
            files: [
              ...listing.files.filter((one) => one !== path),
              ...(stat?.type === 'file' ? [path] : []),
            ],
            folders: [
              ...listing.folders.filter((one) => one !== path),
              ...(stat?.type === 'folder' ? [path] : []),
            ],
          }))
        )
        const patched = inventory.listings.get(parent)
        retain.push(() => inventory.listings.retain(parent, patched))
      }
      changed()
      for (const refresh of retain) refresh()
    }
  }
  private async settleInventoryParents(): Promise<void> {
    const inventory = this.inventory
    if (!inventory?.publishedParents?.size) return
    const parents = [...inventory.publishedParents]
    // Retain membership until all identity reads have settled; a failed pass is discarded.
    for (const path of parents) await this.rememberInventoryParents(path)
    for (const path of parents) inventory.publishedParents.delete(path)
  }
  private async rememberInventoryParents(path: string): Promise<void> {
    if (!path || (this.discovery && this.discovery.roots.length === 0)) return
    const inventory = this.inventory
    if (inventory?.directories === undefined) return
    const before = inventory.directories
    inventory.directories = before.then(async (directories) => {
      const result = [...directories]
      const segments = path.split('/')
      for (let length = 1; length <= segments.length; length++) {
        const parent = segments.slice(0, length).join('/')
        if (!this.withinFileScope(parent)) continue
        if (result.some((one) => one.path === parent)) continue
        const stat = await this.rawStat(parent)
        if (stat?.type !== 'folder') continue
        result.push({
          path: parent,
          identity: await this.directories.identity(parent),
          mtime: stamp(stat.mtime),
        })
        this.updateInventory([parent])
      }
      return result
    })
    await inventory.directories
  }
  private readonly directories: VaultDirectories
  private readonly preserveEmptyDirectories: boolean
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
  private configInventory: FileInfo[] | null = null
  private inventoryConsumed = false
  private readonly configRevision: () => number
  private cachedConfigRevision: number
  private configPolled = false
  private readonly startupInventory?: () => ReadonlyMap<string, FileInfo> | undefined
  private readonly discovery?: ObsidianFileSystemOptions['discovery']
  /** Last engine-visible byte/absence observation, not a fresh read inside a replacement.
   * Digests avoid retaining the vault's binary contents. A later stat never promotes new bytes. */
  private readonly observedBases = new Map<string, { sha: string } | { absent: true }>()
  private readonly legacyRecoveryPaths = new Set<string>()
  private readonly ledger: ObsidianFileSystemOptions['ledger'] | null
  /** Pulls can finish before Obsidian's file index sees their adapter renames. */
  private readonly awaitingIndex = new Set<string>()
  /** Set while `watch` is running: what `kick` reaches for, and nothing when nobody watches. */
  private pollNow: (() => void) | null = null
  private inspectPoll: (() => Promise<boolean>) | null = null
  private readonly writer: VaultWriter
  private readonly io: BoundedVaultIo
  private readonly conditional: ConditionalFiles
  private readonly stages = new Map<string, JournalEntry>()
  /** Completed publications only; durable journal reads still authorize retirement. */
  private readonly publications = new Map<string, string>()
  private readonly stageOperations: Set<string>
  private readonly journal: WriteJournal
  private readonly beforeEngineMutation: ((paths: string[]) => Promise<void>) | null
  private readonly runtimeFence: RuntimeFence | null
  private readonly privateRoot?: string
  private readonly privateRemovalRoot?: string
  private readonly scopedAdapter: DataAdapter;
  [PRIVATE_REMOVAL_FILES](toLocal?: (path: string) => string): FileSystem {
    const owned = (this.privateRemovalRoot ?? '.abele-sync') + '/retained-removals'
    const host = new Proxy(this, {
      get: (target, key) => {
        if (key === 'stat')
          return async (path: string) =>
            !withinRoot(path, owned) && (await this.retainedParentUnavailable(path))
              ? null
              : this.stat(path)
        if (key === 'conditionalFile')
          return async (operation: ConditionalFileOperation) => {
            if (
              withinRoot(operation.path, owned) &&
              operation.effect.kind === 'move' &&
              !withinRoot(operation.effect.to, owned) &&
              (await this.retainedParentUnavailable(operation.effect.to))
            ) {
              const root = this.scopedRoot() ?? ''
              if (
                root &&
                ((await crossesSymlink(root, (path) => this.isSymlink(path))) ||
                  (await this.disk.stat(root))?.type !== 'folder')
              )
                throw new EngineError('io', 'Retained removal root is unavailable; bytes preserved')
              const to =
                (root ? root + '/' : '') +
                'Recovered removal ' +
                crypto.randomUUID() +
                (operation.effect.to.endsWith('.md') ? '.md' : '.bin')
              const restored = await this.conditionalFile({
                ...operation,
                effect: { kind: 'move', to },
              })
              if (restored)
                console.debug('[abele-sync] retained removal restored at root conflict', to)
              return restored
            }
            return this.conditionalFile(operation)
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    return privateRemovalFileSystem(host, this.privateRemovalRoot, toLocal)
  }
  private async retainedParentUnavailable(path: string): Promise<boolean> {
    const parent = path.slice(0, Math.max(0, path.lastIndexOf('/')))
    return (
      !!parent &&
      ((await crossesSymlink(parent, (part) => this.isSymlink(part))) ||
        (await this.disk.stat(parent))?.type !== 'folder')
    )
  }
  private readonly placementStages: ReturnType<typeof privatePlacementStages>
  get [PRIVATE_PLACEMENT_STAGES]() {
    return this.placementStages
  }
  private readonly guardedAdapter: DataAdapter
  private readonly mutationAdapter: (check: () => void) => DataAdapter
  private readonly validateConditionalPath: ConditionalFileHost['validate']
  readonly externalCoordination: ExternalFileCoordination
  readonly pathKey: (path: string) => string

  constructor(
    private readonly app: App,
    options: ObsidianFileSystemOptions = {}
  ) {
    this.app.workspace?.onLayoutReady?.(() => {
      this.layoutReady = true
    })
    this.indexReady()
    this.pathKey = vaultPathKey(app.vault)
    this.placementStages = privatePlacementStages(
      this,
      options.connectionId ? connectionPrivateRoot(options.connectionId) : undefined
    )
    this.scopedAdapter = connectionFilePort(app.vault, options)
    this.privateRoot = options.connectionId
      ? connectionPrivateRoot(options.connectionId)
      : undefined
    const removalOwner = options.connectionId ?? options.journalOwner
    this.privateRemovalRoot = removalOwner ? connectionPrivateRoot(removalOwner) : undefined
    this.stageOperations = stageOperations.get(app.vault) ?? new Set<string>()
    stageOperations.set(app.vault, this.stageOperations)
    this.configRevision = adapterConfigRevision(this.scopedAdapter, app.vault.configDir)
    this.operationRevision = adapterConfigRevision(this.scopedAdapter, '')
    this.cachedConfigRevision = this.configRevision()
    this.preserveEmptyDirectories = options.preserveEmptyDirectories ?? false
    this.fileScope = options.fileScope
    this.startupInventory = options.startupInventory
    this.discovery = options.discovery
    this.runtimeFence = options.runtimeFence ?? null
    this.externalCoordination = externalCoordinationOf(app.vault)
    const runtimePort = (adapter: DataAdapter): DataAdapter =>
      this.runtimeFence
        ? fencedPort(
            adapter,
            this.runtimeFence,
            [
              'write',
              'writeBinary',
              'appendBinary',
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
        : adapter
    const runtimeAdapter = runtimePort(this.scopedAdapter)
    this.diagnostic = options.diagnostic
    const instrument = (runtimeAdapter: DataAdapter): DataAdapter => {
      const guardedMethods = new Map<
        PropertyKey,
        { source: unknown; wrapped: (...args: unknown[]) => unknown }
      >()
      return new Proxy(runtimeAdapter, {
        get: (target, key) => {
          const source = Reflect.get(this.scopedAdapter, key)
          const cached = guardedMethods.get(key)
          if (cached && cached.source === source) return cached.wrapped
          const value = Reflect.get(target, key)
          if (typeof value !== 'function') return value
          // Borrowed only during the synchronous diagnostic callback; no per-call path arrays.
          const diagnosticPaths: string[] = []
          const diagnosticLabel = 'adapter ' + String(key)
          const bound =
            options.diagnostic &&
            [
              'exists',
              'stat',
              'list',
              'readBinary',
              'writeBinary',
              'write',
              'appendBinary',
              'rename',
              'mkdir',
              'remove',
              'rmdir',
              'copy',
            ].includes(String(key))
              ? async (...args: unknown[]) => {
                  const startedAt = Date.now()
                  let outcome = 'failed'
                  try {
                    const result = await value.apply(target, args)
                    outcome = 'complete'
                    return result
                  } finally {
                    diagnosticPaths.length = 0
                    if (typeof args[0] === 'string') diagnosticPaths.push(args[0])
                    if ((key === 'rename' || key === 'copy') && typeof args[1] === 'string')
                      diagnosticPaths.push(args[1])
                    options.diagnostic(diagnosticLabel, startedAt, outcome, diagnosticPaths)
                  }
                }
              : value.bind(target)
          if (
            ![
              'write',
              'writeBinary',
              'appendBinary',
              'append',
              'process',
              'mkdir',
              'rename',
              'remove',
              'rmdir',
              'copy',
            ].includes(String(key))
          ) {
            guardedMethods.set(key, { source, wrapped: bound })
            return bound
          }
          const wrapped = (...args: unknown[]) => {
            const paths = args.slice(0, key === 'rename' || key === 'copy' ? 2 : 1) as string[]
            for (const path of paths) this.inventory?.mutations.add(path)
            if (key === 'rmdir' || key === 'rename' || key === 'remove')
              for (const path of paths)
                for (const parent of this.inventory?.parentFolders ?? [])
                  if (parent === path || parent.startsWith(path + '/'))
                    this.inventory?.parentFolders?.delete(parent)
            this.externalCoordination.assertEnginePaths(paths)
            const result = this.withScanMutation(paths, () => bound(...args))
            if (key !== 'rename') return result
            return Promise.resolve(result).then(async (answer) => {
              const reconcile = Reflect.get(this.scopedAdapter, 'reconcileInternalFile')
              if (typeof reconcile === 'function') {
                this.runtimeFence?.assertOwned()
                await reconcile.call(this.scopedAdapter, paths[1])
                this.runtimeFence?.assertOwned()
              }
              return answer
            })
          }
          guardedMethods.set(key, { source, wrapped })
          return wrapped
        },
      })
    }
    this.guardedAdapter = instrument(runtimeAdapter)
    this.mutationAdapter = (check) =>
      instrument(
        runtimePort(
          guardedVaultAdapter(
            mutationCheckedAdapter(
              this.scopedAdapter,
              () => {
                check()
                this.runtimeFence?.assertOwned()
              },
              [
                stagingDirectory(this.configDir, this.privateRoot),
                options.journalOwner || this.privateRoot
                  ? (this.privateRoot ?? connectionPrivateRoot(options.journalOwner)) +
                    '/conditional'
                  : this.configDir + '/plugins/abele/sync-conditional',
              ]
            )
          )
        )
      )
    this.directories = new VaultDirectories(
      this.guardedAdapter,
      storageOf(app),
      (path) => this.isSymlink(path),
      async (path) => {
        const native = this.native
        if (native) await native.rmdirEmpty(path)
        else await this.guardedAdapter.rmdir(path, false)
        this.updateInventory([path])
        if (this.inventory?.directories !== undefined)
          this.inventory.directories = this.inventory.directories.then((directories) =>
            directories.filter((one) => one.path !== path && !one.path.startsWith(path + '/'))
          )
      },
      this.discovery?.roots ?? (() => this.scopedRoot()),
      (path) =>
        (path === this.configDir || path.startsWith(this.configDir + '/')) &&
        !isDeviceLocalPluginState(path, this.configDir)
    )
    this.beforeEngineMutation = options.beforeEngineMutation ?? null
    this.ledger = options.ledger ?? null
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
    this.now = options.now ?? ((): number => Date.now())
    this.onWatch = options.onWatch ?? null
    this.onEngineWrite = options.onEngineWrite ?? null
    this.yieldsToServer = options.yieldsToServer ?? null
    const journalOwner = options.journalOwner ?? options.connectionId
    this.journal = new WriteJournal(
      options.storage ?? storageOf(app),
      () => this.runtimeFence?.assertOwned(),
      journalOwner,
      options.diagnostic
    )
    this.io = new BoundedVaultIo(
      this.guardedAdapter,
      () => this.runtimeFence?.assertReady(),
      (work) => (this.runtimeFence ? this.runtimeFence.effect(work) : work()),
      this.scopedAdapter,
      this.configDir,
      this.privateRoot
    )
    const checked = !this.native
      ? checkedVaultPort(app.vault, this.guardedAdapter, {
          ready: () => this.runtimeFence?.assertReady(),
          effect: (work) => (this.runtimeFence ? this.runtimeFence.effect(work) : work()),
          diagnostic: options.diagnostic,
        })
      : undefined
    this.writer = new VaultWriter({
      ...(!this.native
        ? {
            createAbsent: async (path: string, bytes: Uint8Array, mtime: number, temp: string) => {
              if (bytes.length > MOBILE_WHOLE_READ_MAX)
                throw new EngineError('io', 'mobile write exceeds the whole-file limit')
              if (
                bytes.length > MAX_CHUNK_BYTES &&
                typeof this.guardedAdapter.appendBinary === 'function'
              ) {
                for (let at = 0; at < bytes.length; at += MAX_CHUNK_BYTES) {
                  const chunk = bytes.slice(at, at + MAX_CHUNK_BYTES).buffer
                  if (at === 0) await this.guardedAdapter.writeBinary(temp, chunk, { mtime })
                  else await this.guardedAdapter.appendBinary(temp, chunk, { mtime })
                }
              } else await this.guardedAdapter.writeBinary(temp, bytes.slice().buffer, { mtime })
              await checked.wait(path)
              const release = await checked.acquire([path])
              try {
                this.runtimeFence?.assertReady()
                release.check()
                await release.wait(this.mutationAdapter(() => release.check()).rename(temp, path))
                release.check()
              } catch (error) {
                if (
                  (error as { code?: string })?.code === 'EEXIST' ||
                  /^(EEXIST\b|File already exists|Destination file already exists)/.test(
                    (error as Error)?.message ?? ''
                  )
                )
                  await release.wait(this.conditional.recoverIncoming(temp, path, release))
                throw error
              } finally {
                release()
              }
            },
          }
        : {}),
      conditionalFile: async (operation) => {
        // Old journals may own backups outside the current private staging root.
        // Admit only the exact owned source for this recovery move, never wire paths.
        const destination = operation.effect.kind === 'move' ? operation.effect.to : undefined
        const legacy =
          destination !== undefined &&
          isAdapterTemp(operation.path) &&
          operation.path.endsWith('.old') &&
          (await this.journal.currentEntries()).some(
            (entry) => entry.backup === operation.path && entry.target === destination
          )
        if (legacy) this.legacyRecoveryPaths.add(operation.path)
        try {
          return await this.conditionalFile(operation)
        } finally {
          if (legacy) this.legacyRecoveryPaths.delete(operation.path)
        }
      },
      retainInstalled: !!options.ledger,
      published: (entry) => {
        if (entry.temp)
          this.publications.set(
            entry.temp,
            JSON.stringify(journalOwner === undefined ? entry : { ...entry, owner: journalOwner })
          )
      },
      stagingDirectory: stagingDirectory(this.configDir, this.privateRoot),
      filesystem: this.guardedAdapter,
      native: this.native,
      journal: this.journal,
      fingerprint: (path) => this.io.fingerprint(path, undefined, true),
      adoptReceipt: (from, to) => this.io.adoptReceipt(from, to),
      indexed: (path) => app.vault.getAbstractFileByPath(path)?.path === path,
      makeParents: (path) => this.makeParents(path),
      installed: (path) => {
        this.awaitingIndex.add(path)
        this.wrote([path], 'file')
      },
    })
    const active = conditionalOperations.get(app.vault) ?? new Set<string>()
    conditionalOperations.set(app.vault, active)
    const conditionalRoot =
      options.journalOwner || this.privateRoot
        ? (this.privateRoot ?? connectionPrivateRoot(options.journalOwner)) + '/conditional'
        : this.configDir + '/plugins/abele/sync-conditional'
    const retentionStorage = options.storage ?? storageOf(app)
    const durable = retentionStorage ? durableHostOf(retentionStorage) : undefined
    const caches = retentionCaches.get(app.vault) ?? new Map<string, RetentionIndex>()
    retentionCaches.set(app.vault, caches)
    const retention =
      durable?.retentionIndex(conditionalRoot) ??
      caches.get(conditionalRoot) ??
      new MemoryRetention()
    caches.set(conditionalRoot, retention)
    const conditionalHost: ConditionalFileHost = {
      retention,
      ...(!this.native
        ? {
            checked: {
              maxBytes: MOBILE_WHOLE_READ_MAX,
              wait: (path: string) => checked.wait(path),
              acquire: (paths: string[]) => checked.acquire(paths),
              publicationCheck: (path: string) => checked.publicationCheck(path),
            },
          }
        : {}),
      root:
        options.journalOwner || this.privateRoot
          ? (this.privateRoot ?? connectionPrivateRoot(options.journalOwner)) + '/conditional'
          : this.configDir + '/plugins/abele/sync-conditional',
      active,
      check: () => this.runtimeFence?.assertReady(),
      validate: (path, recovery = false) => {
        const privatePath =
          (this.privateRoot && withinRoot(path, this.privateRoot)) ||
          (this.privateRemovalRoot &&
            withinRoot(path, this.privateRemovalRoot + '/retained-removals')) ||
          withinRoot(path, stagingDirectory(this.configDir, this.privateRoot)) ||
          withinRoot(path, conditionalRoot) ||
          this.legacyRecoveryPaths.has(path)
        if (privatePath) {
          const parts = path.split('/')
          if (path.includes('\\') || parts.some((part) => !part || part === '.' || part === '..'))
            throw new EngineError('protocol', 'Invalid private work path')
          // Protocol names exclude leading dots; owned work names are not protocol
          // names. Retain all other validation and physical length restrictions.
          assertPhysicalPath(
            parts.map((part) => (part.startsWith('.') ? 'private' + part : part)).join('/')
          )
        } else assertPhysicalPath(path)
        if (
          !recovery &&
          !privatePath &&
          !this.withinFileScope(path) &&
          !(this.privateRoot && withinRoot(path, this.privateRoot))
        )
          throw new EngineError('conflict', 'conditional operation is outside this connection')
        this.externalCoordination.assertEnginePaths([path])
      },
      stat: (path) => this.rawStat(path),
      resumeNamespace: (paths) => {
        if (this.native)
          directEntryDurability(this.disk).resume(
            paths.filter((path) => typeof path === 'string' && path.length > 0)
          )
      },
      retirementStat: (path) => retainedFileStat(this.disk, path),
      fingerprint: async (path, signal) => this.io.fingerprint(path, signal, true),
      create: async (path, bytes, mtime) => {
        // ConditionalFiles flushes the complete record before acknowledging its intent.
        await this.io.create(path, mtime, 'deferred')
        for (let at = 0; at < bytes.length; at += MAX_CHUNK_BYTES)
          await this.io.append(
            path,
            at,
            bytes.slice(at, at + MAX_CHUNK_BYTES),
            mtime,
            undefined,
            'deferred'
          )
      },
      read: (path) => readConditionalRecord(this.disk, this.io, path),
      mkdir: (path) => makeParents(this.disk, path + '/placeholder'),
      list: (path) => this.disk.list(path),
      capture: (from, to) =>
        this.native ? this.native.rename(from, to) : this.disk.rename(from, to),
      restoreDirectory: (from, to) => {
        if (!this.native) return this.disk.rename(from, to)
        if (!this.native.restoreDirectoryExclusive)
          throw new EngineError('io', 'exclusive directory restoration is unavailable')
        return this.native.restoreDirectoryExclusive(from, to)
      },
      install: async (from, to) => {
        if (!this.native) await this.disk.rename(from, to)
        else {
          if (!this.native.installExclusive)
            throw new EngineError('io', 'exclusive native installation is unavailable')
          await this.native.installExclusive(from, to)
        }
        await this.io.adoptReceipt(from, to)
      },
      flush: async (path, parentsOnly) => {
        if (!this.native) return // Mobile adapter acknowledgement is the host durability boundary.
        if (!this.native.syncPath) throw new EngineError('io', 'native durability is unavailable')
        await this.native.syncPath(path, parentsOnly)
      },
      ...(this.native?.sameObject ? { sameObject: (a, b) => this.native.sameObject(a, b) } : {}),
      ...(this.native?.fileIdentity
        ? { fileIdentity: (path: string) => this.native.fileIdentity(path) }
        : {}),
      stage: async (id) => {
        const entry = await this.journal.currentEntry(id)
        if (!entry?.streaming?.sealed || entry.backup || entry.retiredGeneration)
          throw new EngineError('io', 'sealed stage is unavailable')
        return { path: id, target: entry.target, sealed: entry.streaming.sealed }
      },
      changed: (paths, known) => {
        for (const path of paths) this.awaitingIndex.add(path)
        this.wrote(paths, known)
      },
      remove: (path) => this.disk.remove(path),
      rmdir: async (path: string) => {
        if (this.native) return this.native.rmdirEmpty(path)
        // Only an owned, settled metadata folder reaches this callback. Public
        // directories use the identity-bearing, empty-only directory port.
        const entries = await this.disk.list(path)
        if (entries.files.length || entries.folders.length)
          throw new EngineError('conflict', 'conditional metadata folder is not empty')
        await this.disk.rmdir(path, true)
      },
    }
    conditionalHost.withMutationCheck = (check) =>
      this.leasedConditionalHost(conditionalHost, check)
    this.validateConditionalPath = (path) => conditionalHost.validate(path)
    if (this.native?.fileIdentity)
      this.fileIdentity = async (path) => {
        this.runtimeFence?.assertReady()
        this.validateConditionalPath(path)
        return this.native.fileIdentity(path)
      }
    this.conditional = new ConditionalFiles(conditionalHost)
  }

  private leasedConditionalHost(base: ConditionalFileHost, check: () => void): ConditionalFileHost {
    const disk = this.mutationAdapter(check)
    const native = this.nativeFor(disk)
    const io = new BoundedVaultIo(
      disk,
      () => {
        check()
        this.runtimeFence?.assertReady()
      },
      (work) => {
        check()
        return this.runtimeFence ? this.runtimeFence.effect(work) : work()
      },
      this.scopedAdapter,
      this.configDir,
      this.privateRoot
    )
    io.reuseCapabilitiesFrom(this.io)
    return {
      ...base,
      withMutationCheck: undefined,
      stat: (path) => disk.stat(path),
      fingerprint: (path, signal) => io.fingerprint(path, signal, true),
      read: (path) => readConditionalRecord(disk, io, path),
      create: async (path, bytes, mtime) => {
        // The protocol flush is the durability barrier for this complete record.
        await io.create(path, mtime, 'deferred')
        for (let at = 0; at < bytes.length; at += MAX_CHUNK_BYTES)
          await io.append(
            path,
            at,
            bytes.slice(at, at + MAX_CHUNK_BYTES),
            mtime,
            undefined,
            'deferred'
          )
      },
      mkdir: (path) => makeParents(disk, path + '/placeholder'),
      list: (path) => disk.list(path),
      capture: (from, to) => (native ? native.rename(from, to) : disk.rename(from, to)),
      restoreDirectory: (from, to) => {
        if (!native) return disk.rename(from, to)
        if (!native.restoreDirectoryExclusive)
          throw new EngineError('io', 'exclusive directory restoration is unavailable')
        return native.restoreDirectoryExclusive(from, to)
      },
      install: async (from, to) => {
        if (!native) await disk.rename(from, to)
        else {
          if (!native.installExclusive)
            throw new EngineError('io', 'exclusive native installation is unavailable')
          await native.installExclusive(from, to)
        }
        await io.adoptReceipt(from, to)
      },
      flush: async (path, parentsOnly) => {
        if (!native) return
        if (!native.syncPath) throw new EngineError('io', 'native durability is unavailable')
        await native.syncPath(path, parentsOnly)
      },
      ...(native?.sameObject ? { sameObject: (a, b) => native.sameObject(a, b) } : {}),
      ...(native?.fileIdentity
        ? { fileIdentity: (path: string) => native.fileIdentity(path) }
        : {}),
      remove: (path) => disk.remove(path),
      rmdir: async (path) => {
        if (native) return native.rmdirEmpty(path)
        const entries = await disk.list(path)
        if (entries.files.length || entries.folders.length)
          throw new EngineError('conflict', 'conditional metadata folder is not empty')
        await disk.rmdir(path, true)
      },
    }
  }

  /** A streamed replacement owns incoming bytes; an unreadable source is preserved, not proved equal. */
  async [Symbol.for('abele.sync.stream-move-source-v1')](
    operation: ConditionalFileOperation
  ): Promise<boolean> {
    if (
      operation.effect.kind !== 'move' ||
      operation.expected?.identity ||
      (await this.io.canReplayStage())
    )
      return this.conditionalFile(operation)
    const release = this.externalCoordination.beginEngineMutation([
      operation.path,
      operation.effect.to,
    ])
    try {
      const info = await this.stat(operation.path)
      if (
        !operation.expected ||
        !info ||
        info.size !== operation.expected.size ||
        info.mtime !== operation.expected.mtime
      )
        return false
      // The pull's durable stage owns the subsequent replacement. Its ordinary
      // conditional capture retains these unverified bytes before publication.
      const applied = await this.conditional.apply(operation, true)
      if (applied) {
        this.observedBases.delete(this.pathKey(operation.path))
        this.observedBases.delete(this.pathKey(operation.effect.to))
        await this.directories.removedChild(operation.path)
      }
      return applied
    } finally {
      release()
    }
  }

  async conditionalFile(operation: ConditionalFileOperation): Promise<boolean> {
    const release = this.externalCoordination.beginEngineMutation([
      operation.path,
      ...(operation.effect.kind === 'move' ? [operation.effect.to] : []),
    ])
    try {
      if (
        !this.native &&
        operation.effect.kind === 'write' &&
        operation.effect.bytes.length > MOBILE_WHOLE_READ_MAX
      )
        return false
      if (operation.expected === null && operation.effect.kind === 'write' && storageOf(this.app)) {
        this.runtimeFence?.assertReady()
        this.validateConditionalPath(operation.path)
        const { bytes, mtime, receipt } = operation.effect
        const applied = await this.writer.publishAbsent(operation.path, bytes, mtime, receipt)
        if (applied) this.writtenStat = { path: operation.path, size: bytes.length, mtime }
        return applied
      }
      const applied = await this.conditional.apply(operation)
      if (applied && operation.effect.kind === 'move') {
        this.observedBases.delete(this.pathKey(operation.path))
        this.observedBases.delete(this.pathKey(operation.effect.to))
      }
      if (applied && (operation.effect.kind === 'move' || operation.effect.kind === 'remove'))
        await this.directories.removedChild(operation.path)
      if (
        applied &&
        this.native &&
        !Platform.isMobile &&
        !this.preserveEmptyDirectories &&
        (operation.effect.kind === 'move' || operation.effect.kind === 'remove') &&
        !operation.path.startsWith('.') &&
        !operation.path.startsWith(this.configDir + '/')
      ) {
        const scope = this.scopedRoot()
        for (
          let parent = folderOf(operation.path).replace(/\/$/, '');
          parent && parent !== scope;
          parent = folderOf(parent).replace(/\/$/, '')
        ) {
          try {
            await this.native.rmdirEmpty(parent)
          } catch (error) {
            if (
              ['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EBUSY'].includes(
                (error as { code?: string }).code ?? ''
              )
            )
              break
            throw error
          }
        }
      }
      return applied
    } finally {
      release()
    }
  }
  async installedFile(receipt: string, path: string, sha: string): Promise<boolean> {
    return (
      (await this.writer.installedReceipt(receipt, path, sha)) ??
      this.conditional.installed(receipt, path, sha)
    )
  }
  async discardInstallation(receipt: string): Promise<void> {
    if (!(await this.writer.discardReceipt(receipt))) await this.conditional.discard(receipt)
  }
  recoverConditionalFiles(): Promise<void> {
    const root = this.privateRoot
      ? this.privateRoot + '/conditional'
      : this.configDir + '/plugins/abele/sync-conditional'
    if (inspectedAbsent(this.startupInventory?.(), root)) return Promise.resolve()
    return this.conditional.recover()
  }
  private retentionIdle = false
  private retentionTimer?: number
  private retentionRunning?: Promise<void>
  private retentionScheduling?: Promise<void>
  private retentionAbort?: AbortController
  private retentionGeneration = 0;
  [RETENTION_IDLE](idle: boolean): Promise<void> {
    if (idle === this.retentionIdle)
      return Promise.all([this.retentionRunning, this.retentionScheduling]).then(() => {})
    this.retentionIdle = idle
    this.retentionAbort?.abort()
    const controller = new AbortController()
    this.retentionAbort = controller
    const generation = ++this.retentionGeneration
    window.clearTimeout(this.retentionTimer)
    this.retentionTimer = undefined
    if (!idle) return Promise.all([this.retentionRunning, this.retentionScheduling]).then(() => {})
    let retryDelay = 0
    const schedule = async () => {
      await this.retentionRunning
      if (!this.retentionIdle || generation !== this.retentionGeneration) return
      const delay = await this.conditional.maintenanceDelay()
      if (!this.retentionIdle || generation !== this.retentionGeneration || delay === null) return
      this.retentionTimer = window.setTimeout(
        () => {
          if (!this.retentionIdle || generation !== this.retentionGeneration) return
          this.retentionRunning = this.conditional
            .maintenanceStep(() => {
              if (!this.retentionIdle || generation !== this.retentionGeneration)
                throw new Error('retention idle period ended')
            }, controller.signal)
            .then(() => {
              retryDelay = 0
            })
            .catch((error) => {
              retryDelay = 1000
              if (this.retentionIdle && generation === this.retentionGeneration)
                console.debug('[abele-sync] retention maintenance remains pending', error)
            })
            .finally(() => {
              this.retentionRunning = undefined
              if (this.retentionIdle && generation === this.retentionGeneration)
                this.retentionScheduling = schedule().catch((error) =>
                  console.debug('[abele-sync] retention scheduling remains pending', error)
                )
            })
        },
        Math.max(25, retryDelay, Math.min(delay, 0x7fffffff))
      )
    }
    this.retentionScheduling = schedule().catch((error) =>
      console.debug('[abele-sync] retention scheduling remains pending', error)
    )
    return Promise.resolve()
  }

  /** Obsidian desktop's `fs.promises`, or null on a phone (`vaultWrites.nativeOf`). */
  private get native(): NativeFs | null {
    return this.nativeFor(this.disk)
  }

  private nativeFor(disk: DataAdapter): NativeFs | null {
    const raw = nativeOf(
      disk,
      (paths = []) => {
        for (const path of paths) this.inventory?.mutations.add(path)
        this.runtimeFence?.assertOwned()
        this.externalCoordination.assertEnginePaths(paths)
      },
      this.privateRoot ? this.privateRoot + '/recovery' : undefined,
      this.diagnostic
    )
    const native =
      raw &&
      new Proxy(raw, {
        get: (target, key) => {
          const value = Reflect.get(target, key)
          if (
            typeof value !== 'function' ||
            ![
              'rename',
              'replaceFenced',
              'replaceFencedIdentity',
              'installExclusive',
              'restoreDirectoryExclusive',
              'archiveBackup',
              'rmdirEmpty',
            ].includes(String(key))
          )
            return value
          return (...args: unknown[]) => {
            const count = key === 'archiveBackup' || key === 'rmdirEmpty' ? 1 : 2
            return this.withScanMutation(args.slice(0, count) as string[], () =>
              value.apply(target, args)
            )
          }
        },
      })
    return native && this.runtimeFence
      ? fencedPort(
          native,
          this.runtimeFence,
          [
            'rename',
            'rmdirEmpty',
            'replaceFenced',
            'replaceFencedIdentity',
            'installExclusive',
            'restoreDirectoryExclusive',
            'archiveBackup',
            'syncPath',
            'syncFile',
            'sameObject',
            'fileIdentity',
          ],
          false
        )
      : native
  }

  private get disk(): DataAdapter {
    return this.guardedAdapter
  }

  private withScanMutation<T>(paths: readonly string[], work: () => Promise<T>): Promise<T> {
    const visible = paths.some((path) => this.inventoryVisible(path) && this.withinFileScope(path))
    if (visible) this.scanWatchRevision++
    // The engine's own changes retire watcher proofs before and after they land.
    for (const path of paths) this.noteWatchChange(path)
    const settled = () => {
      if (visible) this.scanWatchRevision++
      for (const path of paths) this.noteWatchChange(path)
    }
    return Promise.resolve(this.withScanCacheMutation(paths, work)).finally(settled)
  }
  private withScanCacheMutation<T>(paths: readonly string[], work: () => Promise<T>): Promise<T> {
    const local = storageOf(this.app)
    const host = local ? durableHostOf(local) : undefined
    const keys = paths
      .filter((path) => this.cacheableScanPath(path))
      // Retire a pre-normalization spelling as well as the current canonical key.
      .flatMap((path) => [this.pathKey(path), path])
    return host && keys.length ? host.withScanMutation(keys, work) : work()
  }

  private cacheableScanPath(path: string): boolean {
    return (
      !isDeviceLocalPluginState(path, this.configDir) &&
      !(this.privateRoot && withinRoot(path, this.privateRoot)) &&
      !withinRoot(path, stagingDirectory(this.configDir, this.privateRoot))
    )
  }

  private async makeParents(path: string): Promise<void> {
    const inventory = this.inventory
    const known = inventory
      ? (inventory.parentFolders ??= new InventoryProofs((path) =>
          this.parentRevision(path, inventory)
        ))
      : undefined
    try {
      await makeParents(this.disk, path, known)
    } catch (error) {
      known?.clear()
      throw error
    }
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

  private scopedRoot(): string | undefined {
    const root = typeof this.fileScope === 'function' ? this.fileScope() : this.fileScope
    return root && root !== '/' ? root : undefined
  }
  private withinFileScope(path: string): boolean {
    const root = this.scopedRoot()
    if (!root) return true
    try {
      assertPhysicalPath(path)
    } catch {
      return false
    }
    return path === root || path.startsWith(root + '/')
  }

  /** Existing installation recovery runs before scanner/watcher activation. */
  private inventoryVisible(path: string): boolean {
    return (
      ((path === this.configDir && isWireConfigDir(this.configDir)) ||
        !isHidden(path, this.configDir)) &&
      !isDeviceLocalPluginState(path, this.configDir) &&
      !isAdapterTemp(path)
    )
  }
  async *listDirectories() {
    for await (const directory of this.listDirectoriesUnlocked())
      if (this.inventoryVisible(directory.path)) yield directory
  }
  private async *listDirectoriesUnlocked() {
    this.runtimeFence?.assertReady()
    const scope = this.scopedRoot()
    if (this.discovery && !scope) {
      yield* this.directories.list([], () => false)
      return
    }
    if (scope) {
      if (await crossesSymlink(scope, (prefix) => this.isSymlink(prefix))) return
      yield* this.directories.list()
      return
    }
    const folders = (await this.physicalPaths()).folders
    yield* this.directories.list([...folders])
  }
  /** A folder token's subtree, or undefined when the whole vault is enumerated. */
  private boundedScope(): string | undefined {
    const requested = typeof this.fileScope === 'function' ? this.fileScope() : this.fileScope
    return requested && requested !== '/' ? requested : undefined
  }
  /** Bounded alias recheck inside an existing placement lease; recovery runs before it. */
  async listChildren(parent: string) {
    this.runtimeFence?.assertReady()
    if (parent && !this.inventoryVisible(parent)) return []
    const children = this.inventory
      ? await this.inventory.children.stable(parent, () => this.readInventoryChildren(parent))
      : await this.readInventoryChildren(parent)
    return children.filter((one) => this.inventoryVisible(one.path)).map((one) => ({ ...one }))
  }
  private async readInventoryChildren(parent: string): Promise<InventoryChild[]> {
    const scope = this.scopedRoot()
    if (scope && (parent === '' || scope.startsWith(parent + '/'))) {
      const path = scope
        .split('/')
        .slice(0, parent ? parent.split('/').length + 1 : 1)
        .join('/')
      if (path === scope && (await this.rawStat(path))?.type !== 'folder') return []
      return [
        {
          path,
          kind: 'directory',
          identity:
            path === scope
              ? await this.directories.identity(path, true)
              : 'scope-ancestor:' + this.pathKey(path),
        },
      ]
    }
    if (scope && !this.withinFileScope(parent))
      throw new EngineError('protocol', 'Inventory path is outside this connection')
    if (this.discovery && this.discovery.roots.length === 0 && this.indexReady()) {
      const children = new Map<string, InventoryChild>()
      for (const file of this.app.vault.getFiles()) {
        if (
          !this.inventoryVisible(file.path) ||
          !this.discovery.includes(file.path) ||
          (parent && !file.path.startsWith(parent + '/'))
        )
          continue
        const prefix = parent ? parent + '/' : ''
        const tail = file.path.slice(prefix.length)
        const cut = tail.indexOf('/')
        const path = cut < 0 ? file.path : prefix + tail.slice(0, cut)
        children.set(
          path,
          cut < 0
            ? { path, kind: 'file' }
            : { path, kind: 'directory', identity: await this.directories.identity(path, true) }
        )
      }
      return [...children.values()]
    }
    const listing = await this.inventoryListing(parent)
    const children: InventoryChild[] = listing.files
      .filter((path) => this.inventoryVisible(path))
      .map((path) => ({ path, kind: 'file' }))
    for (const path of listing.folders) {
      if (!this.inventoryVisible(path)) continue
      if (await this.isSymlink(path)) continue
      children.push({
        path,
        kind: 'directory',
        identity: await this.directories.identity(path, true),
      })
    }
    return children
  }
  [Symbol.for('abele.sync.directory-identity-v1')](path: string): Promise<string> {
    this.runtimeFence?.assertReady()
    return this.directories.identity(path)
  }
  async mkdir(path: string): Promise<void> {
    this.runtimeFence?.assertReady()
    await this.beforeEngineMutation?.([path])
    if (await crossesSymlink(path, (prefix) => this.isSymlink(prefix)))
      throw new EngineError('conflict', 'Directory path contains a symbolic link')
    const parts = path.split('/')
    const prefixes = parts.map((_, index) => parts.slice(0, index + 1).join('/'))
    const missing: string[] = []
    for (const prefix of prefixes.filter((one) => this.withinFileScope(one)))
      if (!(await this.rawStat(prefix))) missing.push(prefix)
    await this.directories.mkdir(path)
    // Obsidian indexes what its adapter makes only when its file watcher reports it. Remember
    // each folder this made, parents included, so the inventory finds them before the index.
    for (const made of missing)
      if ((await this.rawStat(made))?.type === 'folder') await this.directories.identity(made)
    // A confirmed existing folder may have appeared through private work since a raw
    // parent listing was read. Refresh its membership as well as newly created prefixes.
    this.updateInventory(missing.filter((one) => this.withinFileScope(one)))
    this.updateInventory(
      prefixes.filter((one) => this.withinFileScope(one) && !missing.includes(one)),
      'folder',
      true
    )
    await this.rememberInventoryParents(path)
  }
  async moveDirectory(from: string, to: string): Promise<void> {
    this.invalidateRootChain([from, to])
    this.runtimeFence?.assertReady()
    await this.beforeEngineMutation?.([from, to])
    await this.directories.move(from, to)
    if (this.inventory) {
      this.inventory.directories = undefined
      this.inventory.listings.clear()
      this.inventory.children.clear()
      this.inventory.indexedChildren.clear()
      this.inventory.publishedParents?.clear()
    }
  }
  async removeDirectory(path: string, expectedIdentity?: string): Promise<void> {
    const retainedRoot = this.privateRemovalRoot && this.privateRemovalRoot + '/retained-removals'
    if (
      retainedRoot &&
      expectedIdentity === undefined &&
      (path === retainedRoot ||
        (path.startsWith(retainedRoot + '/') &&
          /^[a-f0-9-]{36}$/.test(path.slice(retainedRoot.length + 1))))
    ) {
      this.runtimeFence?.assertReady()
      if (this.native) await this.native.rmdirEmpty(path)
      else {
        const rows = await this.disk.list(path)
        if (rows.files.length || rows.folders.length)
          throw new EngineError('conflict', 'Retained removal directory is not empty')
        await this.disk.rmdir(path, false)
      }
      return
    }
    this.invalidateRootChain([path])
    this.runtimeFence?.assertReady()
    await this.beforeEngineMutation?.([path])
    await this.directories.remove(path, expectedIdentity)
    if (this.inventory) {
      this.inventory.directories = undefined
      this.inventory.listings.clear()
      this.inventory.children.clear()
      this.inventory.indexedChildren.clear()
      this.inventory.publishedParents?.clear()
    }
  }
  async needsRecoveryHandshake(): Promise<boolean> {
    return (
      (await this.journal.currentEntries()).some(
        (entry) => !entry.retiredGeneration && (!entry.streaming || entry.backup)
      ) || (await this.journal.currentVaultRecovered()).length > 0
    )
  }
  /** Called only after explicit Follow verified the destination file set. */
  async followRecoveredRoot(from: string, to: string): Promise<void> {
    this.runtimeFence?.assertReady()
    assertPhysicalPath(from)
    assertPhysicalPath(to)
    const privateRoot = this.privateRoot
    if (!privateRoot || from !== this.scopedRoot())
      throw new EngineError('io', 'The recovery placement changed; sync remains stopped')
    // Unfinished installs cannot be relabelled or replayed into a different placement.
    if (
      (await this.journal.currentEntries()).some((entry) => !withinRoot(entry.target, privateRoot))
    )
      throw new EngineError('io', 'Unfinished file recovery prevents following the folder')
    const fullArchive = nativeChunkPort(this.disk)
      .fullPath?.(privateRoot + '/recovery')
      ?.replace(/\\/g, '/')
    const backupSuffix = (backup: string): string | undefined => {
      if (withinRoot(backup, privateRoot)) return backup.slice(privateRoot.length)
      const native = backup.replace(/\\/g, '/')
      return fullArchive && native.startsWith(fullArchive + '/')
        ? '/recovery' + native.slice(fullArchive.length)
        : undefined
    }
    if (
      (await this.journal.currentRecovered()).some(
        (entry) =>
          (!withinRoot(entry.target, from) &&
            !withinRoot(entry.target, to) &&
            !withinRoot(entry.target, privateRoot)) ||
          backupSuffix(entry.backup) === undefined
      )
    )
      throw new EngineError('io', 'Unproven recovery copy prevents following the folder')
    for (const entry of await this.journal.currentRecovered()) {
      // Private evidence is outside the wire namespace; validate its relative suffix.
      assertPhysicalPath(
        withinRoot(entry.target, privateRoot)
          ? 'Recovery' + entry.target.slice(privateRoot.length)
          : entry.target
      )
      // Native archives retain absolute paths. Authorize only the exact owned archive root,
      // then validate its suffix without granting access to any native path.
      assertPhysicalPath('Recovery' + backupSuffix(entry.backup))
    }
    await this.journal.persist(() => this.journal.relocateRecoveredTargets(from, to))
  }

  async recover(): Promise<void> {
    this.runtimeFence?.assertOwned()
    if (
      this.scopedRoot() &&
      [
        ...(await this.journal.currentEntries()),
        ...(await this.journal.currentVaultRecovered()),
      ].some(
        (entry) =>
          !this.withinFileScope(entry.target) &&
          !(this.privateRoot && withinRoot(entry.target, this.privateRoot)) &&
          !(
            'streaming' in entry &&
            entry.streaming &&
            !entry.backup &&
            privateDownload(entry.target)
          )
      )
    )
      throw new EngineError(
        'io',
        'Sync recovery outside this connection is required; local files were kept'
      )
    await this.recoverConditionalFiles()
    this.runtimeFence?.assertOwned()
    if (this.ledger?.readCommittedEntries) {
      const paths = (await this.journal.currentEntries())
        .filter(
          (entry) =>
            entry.replacementSha &&
            !entry.backup &&
            !entry.retiredGeneration &&
            this.withinFileScope(entry.target)
        )
        .map((entry) => entry.target)
      if (paths.length)
        await this.acknowledgeWrites(await this.ledger.readCommittedEntries([...new Set(paths)]))
    }
    if (
      !(await this.journal.currentEntries()).length &&
      !(this.native?.archiveBackup && (await this.journal.currentVaultRecovered()).length)
    )
      return
    await pathCoordinatorOf(this.app.vault).run(
      [''],
      async () => {
        // Recovery can touch journal-owned paths not known until its asynchronous inspection.
        const release = this.externalCoordination.beginEngineMutation([''])
        try {
          this.runtimeFence?.assertOwned()
          const publishedTargets = new Set<string>()
          if (this.native) {
            const entries = await this.journal.currentEntries()
            directEntryDurability(this.disk).resume(
              entries.flatMap((entry) =>
                [entry.target, entry.temp, entry.backup].filter(
                  (path): path is string => !!path && !path.startsWith('/')
                )
              )
            )
          }
          await this.writer.recover(publishedTargets)
          if (publishedTargets.size && this.ledger?.readCommittedEntries)
            await this.acknowledgeWrites(
              await this.ledger.readCommittedEntries([...publishedTargets])
            )
          this.runtimeFence?.assertOwned()
        } finally {
          release()
        }
      },
      () => this.runtimeFence?.assertOwned()
    )
  }

  /** Called with committed rows, or a committed startup inventory, never overlay entries. */
  async acknowledgeWrites(entries: readonly StateEntry[]): Promise<void> {
    const byPath = new Map(entries.map((entry) => [entry.path, entry.sha]))
    const installed: JournalEntry[] = []
    for (const entry of await this.journal.currentForTargets([...byPath.keys()])) {
      if (
        entry.backup ||
        entry.conditionalReceipt ||
        entry.retiredGeneration ||
        !entry.replacementSha ||
        byPath.get(entry.target) !== entry.replacementSha
      )
        continue
      if (entry.temp && (this.stageOperations.has(entry.temp) || adapterWriteInFlight(entry.temp)))
        continue
      if (entry.disposableSource && entry.temp) {
        // An interrupted fresh batch can leave an uninstalled server-only cache.
        // The matching committed row now owns that version; never touch the public name.
        if (await this.rawStat(entry.temp)) await this.disk.remove(entry.temp)
        if (this.native) await this.native.syncPath(entry.temp, true)
        installed.push(entry)
        continue
      }
      const published = entry.temp && this.publications.get(entry.temp) === JSON.stringify(entry)
      if (!entry.installed && !published && (!entry.temp || (await this.rawStat(entry.temp))))
        continue
      installed.push(entry)
    }
    if (!installed.length) return
    await this.journal.persist(async () => {
      for (const entry of installed)
        if (await this.journal.isCurrent(entry)) this.journal.drop(entry)
    })
    for (const entry of installed) if (entry.temp) this.publications.delete(entry.temp)
  }

  async discardPrivateDownloads(): Promise<void> {
    if (!this.privateRoot) return
    for (const entry of await this.journal.currentEntries())
      if (
        !entry.retiredGeneration &&
        entry.streaming &&
        !entry.backup &&
        entry.temp &&
        !this.stageOperations.has(entry.temp) &&
        withinRoot(entry.target, this.privateRoot + '/placement-inbox') &&
        withinRoot(entry.temp, this.privateRoot)
      ) {
        if ((await this.rawStat(entry.temp)) === null) {
          // Creation and discard each have a durable-intent/missing-file crash window.
          await this.journal.persist(() => this.journal.drop(entry))
          this.stages.delete(entry.temp)
        } else await (await this.reopenStage(entry.temp)).discard()
      }
  }

  async retireGeneration(
    generation: string,
    archive: (value: unknown) => Promise<void>
  ): Promise<void> {
    this.runtimeFence?.assertOwned()
    this.io.retireReceipts()
    await this.journal.retireGeneration(generation, archive)
    this.publications.clear()
  }

  /** A retained streaming source is not a pending destructive installation. */
  async fenceRecovery(state: StateStore, head: number): Promise<void> {
    const entries = (await this.journal.currentEntries()).filter(
      (entry) => !entry.retiredGeneration && (!entry.streaming || entry.backup)
    )
    if (!entries.length) return
    const reconciliation = await readReconciliation(state)
    if (
      head <= (await state.getCursor()) &&
      (!reconciliation || reconciliation.phase === 'complete')
    )
      return
    await requestReconciliation(
      state,
      'server advanced with pending local writes; possible restored profile'
    )
    const key =
      'reconciliation-host-writes:' +
      (await sha256(new TextEncoder().encode(JSON.stringify(entries))))
    await this.retireGeneration('local-reconciliation', async (value) => {
      if (!(await state.getMeta(key))) await state.setMeta(key, JSON.stringify(value))
    })
  }

  /** Placement needs immutable copies of its targets, not another full vault scan. */
  async *placementFiles(paths: readonly string[]): AsyncIterable<FileInfo> {
    this.runtimeFence?.assertReady()
    // Called with path leases held. Recovery takes the whole-vault lease, so it must
    // run before placement; a different connection may have a live journal meanwhile.
    for (const entry of await this.journal.currentEntries())
      if (
        !entry.retiredGeneration &&
        (!entry.streaming || entry.backup !== undefined) &&
        paths.some((path) => {
          const target = this.pathKey(entry.target),
            key = this.pathKey(path)
          return target === key || target.startsWith(key + '/') || key.startsWith(target + '/')
        })
      )
        throw new EngineError('io', 'placement needs write recovery before acquiring its lease')
    for (const path of new Set(paths)) {
      const stat = await this.disk.stat(path)
      if (stat?.type === 'folder') yield* this.walkConfig(path)
      else if (stat?.type === 'file') {
        const info = await this.fileAt(path)
        if (info) yield info
      }
    }
  }

  /** Read-only fallback consumers share one committed ledger snapshot per inventory.
   * Entry changes and unknown writers retire it; metadata-only commits do not. */
  private async *ledgerEntries(): AsyncIterable<StateEntry> {
    const ledger = this.ledger
    if (!ledger) return
    const inventory = this.inventory
    const clock = Reflect.get(ledger, Symbol.for('abele.sync.local-scan-state-revision-v1'))
    const revision = inventory && typeof clock === 'function' ? await clock.call(ledger) : undefined
    if (!inventory || revision === undefined) {
      yield* ledger.all()
      return
    }
    let snapshot = inventory.ledgerRows
    if (!snapshot || snapshot.revision !== revision) {
      snapshot = { revision, rows: await Array.fromAsync(ledger.all()) }
      if (revision === (await clock.call(ledger))) inventory.ledgerRows = snapshot
      else inventory.ledgerRows = undefined
    }
    const budget = new SyncTaskBudget()
    for (const row of snapshot.rows) {
      await budget.account(4096)
      yield row
    }
  }

  async *list(): AsyncIterable<FileInfo> {
    const own = this.inventory === null && this.inventoryDepth === 0
    const inventory = own ? this.createInventory() : this.inventory
    if (own) this.inventory = inventory
    try {
      yield* this.listUnlocked()
    } finally {
      if (own && this.inventory === inventory) this.inventory = null
    }
  }
  private async *listUnlocked(): AsyncIterable<FileInfo> {
    const budget = new SyncTaskBudget()
    const scope = this.scopedRoot()
    this.runtimeFence?.assertReady()
    await this.recover()
    const conditionalRevision = this.conditional.assertSettled()
    const mutations = folderMutations(this.app.vault)
    await mutations.settled()
    const revision = mutations.revision
    const indexed = new Set<string>()
    const withinScope = (path: string) => this.withinFileScope(path)
    const files =
      this.discovery && this.discovery.roots.length === 0 && this.indexReady()
        ? this.app.vault.getFiles().filter((file) => this.discovery.includes(file.path))
        : this.rawVaultFiles(scope)
    for await (const file of files) {
      await budget.account(4096)
      if (!withinScope(file.path) || (this.discovery && !this.discovery.includes(file.path)))
        continue
      if (!this.inventoryVisible(file.path)) continue
      if (this.awaitingIndex.has(file.path)) {
        const actual = await this.rawStat(file.path)
        if (!actual || actual.type !== 'file') continue
        if (actual.size === file.stat.size && stamp(actual.mtime) === stamp(file.stat.mtime))
          this.awaitingIndex.delete(file.path)
        indexed.add(this.pathKey(file.path))
        yield { path: file.path, size: actual.size, mtime: stamp(actual.mtime) }
        continue
      }
      indexed.add(this.pathKey(file.path))
      yield { path: file.path, size: file.stat.size, mtime: stamp(file.stat.mtime) }
    }
    // A pull can finish before the index sees its adapter renames, including across engine
    // rebuilds and app restarts. The ledger is authoritative about what might still be on disk.
    const candidates = new Set(this.awaitingIndex)
    if (this.ledger !== null) {
      for await (const entry of this.ledgerEntries()) {
        await budget.account(4096)
        candidates.add(entry.path)
      }
    }
    for (const path of candidates) {
      await budget.account(4096)
      if (!withinScope(path) || !this.inventoryVisible(path)) continue
      if (this.discovery && !this.discovery.includes(path)) continue
      if (indexed.has(this.pathKey(path)) || path.startsWith(`${this.configDir}/`)) {
        continue
      }
      // stat alone on a case-folding disk would keep a phantom Report.md after a rename to
      // report.md. List its parent for the actual spelling, and never yield both names.
      const actual = await this.spellingOnDisk(path)
      const info = actual === null || !withinScope(actual) ? null : await this.fileAt(actual)
      if (info !== null && !indexed.has(this.pathKey(info.path))) {
        indexed.add(this.pathKey(info.path))
        yield info
      }
      if ((info === null || actual !== path) && !this.app.vault.getFileByPath(path))
        this.awaitingIndex.delete(path)
    }
    if (!scope && !this.discovery) {
      const configRevision = this.configRevision()
      if (this.cachedConfigRevision !== configRevision) {
        this.configInventory = null
        this.inventoryConsumed = true
      }
      if (!this.startupInventory) this.configInventory = null
      if (this.configInventory === null) {
        const inventory = this.inventoryConsumed ? undefined : this.startupConfigInventory()
        this.inventoryConsumed = true
        this.configInventory = inventory ?? (await this.readConfigInventory())
        this.cachedConfigRevision = configRevision
      }
      for (const info of this.configInventory) yield await this.told(info, true)
    }
    this.conditional.assertSettled(conditionalRevision)
    if (mutations.revision !== revision) {
      throw new EngineError(
        'io',
        'a folder deletion started during the scan; scan again after it finishes'
      )
    }
  }

  /** Indexed files, bounded to a folder token's subtree without touching the whole index. */
  private indexedFiles(scope?: string): TFile[] {
    if (!scope) return this.app.vault.getFiles()
    const walk = function* (entry: TFile | TFolder): Generator<TFile> {
      if (entry instanceof TFile) yield entry
      else for (const child of entry.children) yield* walk(child as TFile | TFolder)
    }
    const root = this.app.vault.getAbstractFileByPath(scope)
    return root ? [...walk(root as TFile | TFolder)] : []
  }

  /** Expand only components that can have a distinct canonical spelling. */
  private async physicalPaths(
    scope?: string
  ): Promise<{ files: Set<string>; folders: Set<string> }> {
    if (this.indexReady() === false) {
      const files = new Set<string>()
      const folders = new Set<string>()
      for await (const file of this.diskVaultFiles(scope, folders)) files.add(file.path)
      return { files, folders }
    }
    const budget = new SyncTaskBudget()
    const files = new Set(this.indexedFiles(scope).map((file) => file.path))
    const folders = new Set<string>()
    const within = (path: string) => !scope || path === scope || path.startsWith(scope + '/')
    // A folder token reads only its own subtree and the folders leading down to it.
    const relevant = (path: string) => within(path)
    const visible = (path: string) => this.inventoryVisible(path)
    const root =
      scope === undefined ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(scope)
    const index = async (node: { path: string; children?: unknown[] }) => {
      await budget.account(4096)
      if (node.path && !visible(node.path)) return
      if (!node.children) return
      if (node.path) folders.add(node.path)
      for (const child of node.children) await index(child as typeof node)
    }
    // The vault root has path '/', not ''. It is a traversal anchor, never a sync item.
    if (scope === undefined) {
      for (const child of (root as { children?: unknown[] } | null)?.children ?? [])
        await index(child as { path: string; children?: unknown[] })
    } else if (root) await index(root)
    for (const path of files) {
      await budget.account(4096)
      for (let cut = path.indexOf('/'); cut !== -1; cut = path.indexOf('/', cut + 1))
        if (within(path.slice(0, cut))) folders.add(path.slice(0, cut))
    }
    const indexedFiles = new Set(files)
    const indexedFolders = new Set(folders)
    // Built once per listing: a walk must not rescan every vault path for every folder it
    // visits, which made large vaults with many accented names stall the app.
    const parentOf = (path: string) => folderOf(path).replace(/^\/$/, '')
    const byParent = new Map<string, Set<string>>()
    const addFile = (path: string) => {
      files.add(path)
      const parent = parentOf(path)
      let group = byParent.get(parent)
      if (!group) byParent.set(parent, (group = new Set()))
      group.add(path)
    }
    const dropFile = (path: string) => {
      files.delete(path)
      byParent.get(parentOf(path))?.delete(path)
    }
    for (const path of files) {
      await budget.account(4096)
      addFile(path)
    }
    const under = async (paths: Iterable<string>, self: boolean) => {
      const result = new Map<string, string[]>()
      const put = (key: string, path: string) => {
        const list = result.get(key)
        if (list) list.push(path)
        else result.set(key, [path])
      }
      for (const path of paths) {
        await budget.account(4096)
        const key = this.pathKey(path)
        for (let cut = key.indexOf('/'); cut !== -1; cut = key.indexOf('/', cut + 1))
          put(key.slice(0, cut), path)
        if (self) put(key, path)
      }
      return result
    }
    const filesUnder = await under(indexedFiles, false)
    const foldersAt = await under(indexedFolders, true)
    const parents = new Set<string>()
    for (const path of [...files, ...folders]) {
      await budget.account(4096)
      const segments = path.split('/')
      const risk = segments.findIndex(normalizationPossible)
      if (risk !== -1) {
        const parent = segments.slice(0, risk).join('/')
        parents.add(scope && !within(parent) ? scope : parent)
      }
    }
    const visited = new Set<string>()
    const links = new Map<string, Promise<boolean | null>>()
    const linked = (path: string) => crossesSymlink(path, (one) => this.isSymlink(one), links)
    const walk = async (parent: string, recursive: boolean, depth = 0): Promise<void> => {
      if (depth > CONFIG_WALK_DEPTH) {
        if (!parent.startsWith(this.configDir + '/'))
          throw new EngineError('io', 'Directory tree is too deep')
        console.debug(`[abele-sync] not following ${parent} any further`)
        return
      }
      if (visited.has(parent)) return
      visited.add(parent)
      // Raw discovery never reaches past a symlink; a linked parent keeps its indexed view.
      if (await linked(parent)) return
      let listing: ListedFiles
      try {
        listing = await this.inventoryListing(parent)
      } catch (cause) {
        throw new EngineError('io', 'Cannot enumerate physical vault names', cause)
      }
      const priorFiles = [...(byParent.get(parent) ?? [])]
      const candidatesByWire = new Map<string, string[]>()
      for (const path of priorFiles) {
        const key = path.normalize('NFC')
        const candidates = candidatesByWire.get(key) ?? []
        candidates.push(path)
        candidatesByWire.set(key, candidates)
      }
      const listedFiles = new Set(listing.files)
      for (const path of priorFiles) dropFile(path)
      for (const listedPath of listing.files) {
        const candidates = candidatesByWire.get(listedPath.normalize('NFC')) ?? []
        const preferred =
          candidates.length === 1 &&
          !listedFiles.has(candidates[0]) &&
          (await this.rawStat(candidates[0]))
            ? candidates[0]
            : listedPath
        const path = preferred
        if (
          visible(path) &&
          !isAdapterTemp(path) &&
          within(path) &&
          (indexedFiles.has(path) || !(await this.isSymlink(path)))
        )
          addFile(path)
      }
      const expanded = listing.folders.filter(
        (child) => relevant(child) && (recursive || normalizationPossible(child))
      )
      for (const child of expanded) {
        const key = this.pathKey(child)
        for (const path of filesUnder.get(key) ?? []) if (indexedFiles.delete(path)) dropFile(path)
        for (const path of foldersAt.get(key) ?? [])
          if (indexedFolders.delete(path)) folders.delete(path)
      }
      for (const child of listing.folders) {
        if (!visible(child) || isDeviceLocalPluginState(child, this.configDir) || !relevant(child))
          continue
        if (await this.isSymlink(child)) continue
        if (recursive || normalizationPossible(child)) {
          if (within(child)) folders.add(child)
          await walk(child, recursive || within(child), depth + 1)
        } else if (within(child)) folders.add(child)
      }
    }
    for (const parent of parents) await walk(parent, false)
    // A folder connection's own folder can be on disk before Obsidian indexes it, as right
    // after a pull made it. Read it from the disk then, or it would look empty.
    if (scope !== undefined && !root && (await this.rawStat(scope))?.type === 'folder') {
      folders.add(scope)
      await walk(scope, true)
    }
    if (
      !scope &&
      !this.startupInventory &&
      !visited.has(this.configDir) &&
      (await this.rawStat(this.configDir))
    ) {
      folders.add(this.configDir)
      await walk(this.configDir, true)
    }
    return { files, folders }
  }
  private async *rawVaultFiles(scope?: string): AsyncIterable<{
    path: string
    stat: { size: number; mtime: number }
  }> {
    const indexed = new Map(this.indexedFiles(scope).map((file) => [file.path, file]))
    const readiness = this.indexReady()
    let useDisk = readiness === false
    // A bounded rotating metadata probe detects a clean-looking but stale index without
    // turning every restart into a disk stat of every indexed path.
    if (readiness === true && indexed.size) {
      const files = [...indexed.values()]
      const startup = this.startupInventory?.()
      for (let n = 0; n < Math.min(16, files.length); n++) {
        const file = files[this.indexProbe++ % files.length]
        const inspected = startup?.get(file.path)
        if (inspected?.size === file.stat.size && inspected.mtime === stamp(file.stat.mtime))
          continue
        if (await crossesSymlink(file.path, (path) => this.isSymlink(path))) continue
        const stat = await this.rawStat(file.path)
        if (
          !stat ||
          stat.type !== 'file' ||
          stat.size !== file.stat.size ||
          stat.mtime !== file.stat.mtime
        )
          useDisk = this.indexFallback = true
      }
      if (this.indexReady() !== true || this.indexedFiles(scope).length !== indexed.size)
        useDisk = this.indexFallback = true
    }
    if (useDisk) {
      yield* this.diskVaultFiles(scope)
      return
    }
    for (const path of (await this.physicalPaths(scope)).files) {
      if (readiness === true && this.indexReady() !== true)
        throw new EngineError('io', 'Host index changed during inventory; retry using disk')
      if (isHidden(path, '')) continue
      const file = indexed.get(path)
      // An indexed row keeps the index's own stat: the caller compares it with the disk to
      // learn whether Obsidian has caught up with a write it is still waiting on.
      const stat = file ? file.stat : await this.rawStat(path)
      if (stat) yield { path, stat }
    }
  }

  private async *diskVaultFiles(
    scope?: string,
    folders?: Set<string>
  ): AsyncIterable<{ path: string; stat: Stat }> {
    const budget = new SyncTaskBudget()
    const spellings = new Map<string, Set<string>>()
    const remember = (path: string) => {
      if (!normalizationPossible(path)) return
      const key = path.normalize('NFC')
      const known = spellings.get(key) ?? new Set<string>()
      known.add(path)
      spellings.set(key, known)
    }
    for (const file of this.indexedFiles(scope)) {
      await budget.account(4096)
      remember(file.path)
    }
    if (this.ledger)
      for await (const entry of this.ledgerEntries()) {
        await budget.account(4096)
        if (this.withinFileScope(entry.path)) remember(entry.path)
      }
    const pending = [scope ?? '']
    const visited = new Set<string>()
    while (pending.length) {
      const parent = pending.pop()
      if (visited.has(parent)) continue
      visited.add(parent)
      if (parent && (await this.isSymlink(parent))) continue
      if (parent) folders?.add(parent)
      const listing = await this.inventoryListing(parent)
      const listed = new Set(listing.files)
      for (const rawPath of listing.files) {
        await budget.account(4096)
        const candidates = spellings.get(rawPath.normalize('NFC'))
        const preferred = candidates?.size === 1 ? [...candidates][0] : undefined
        const path =
          preferred && !listed.has(preferred) && (await this.rawStat(preferred))
            ? preferred
            : rawPath
        if (isHidden(path, '') || !this.withinFileScope(path)) continue
        if (await this.isSymlink(path)) continue
        const stat = await this.rawStat(path)
        if (stat?.type === 'file') yield { path, stat }
      }
      for (const path of listing.folders) {
        await budget.account(4096)
        if (!isHidden(path, '')) pending.push(path)
      }
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
    const seen = (await this.fileSnapshot(info.path)) ?? 'absent'
    if (listed) this.yielded.set(info.path, seen)
    else if ((this.yielded.get(info.path) ?? seen) !== seen) return info
    return { ...info, mtime: 0 }
  }

  /** Bounded native reads where available; portable candidates are capped by the attachment
   * ceiling and inspected one at a time. This never promotes a prefix to a proven local base. */
  async readPrefix(path: string, maximum: number): Promise<Uint8Array> {
    this.runtimeFence?.assertReady()
    const adapter = this.disk as DataAdapter & {
      readBinaryPrefix?(path: string, maximum: number): Promise<ArrayBuffer | Uint8Array>
    }
    const native = nativeChunkPort(adapter)
    if (adapter.readBinaryPrefix) {
      const bytes = await adapter.readBinaryPrefix(path, maximum)
      return (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).subarray(0, maximum)
    }
    if (native.fullPath && native.open) {
      const handle = await native.open(native.fullPath(path), 'r')
      try {
        const bytes = new Uint8Array(maximum)
        const result = await handle.read(bytes, 0, maximum, 0)
        return bytes.subarray(0, result.bytesRead)
      } finally {
        await handle.close()
      }
    }
    const info = await this.rawStat(path)
    if (info === null || info.type !== 'file' || info.size > 200 * 1024 * 1024)
      return new Uint8Array()
    const source = await this.io.openRead(path)
    try {
      const bytes = await source.read(0, Math.min(maximum, source.size, MAX_CHUNK_BYTES))
      await source.assertUnchanged()
      return bytes
    } finally {
      await source.close()
    }
  }

  async read(path: string): Promise<Uint8Array> {
    try {
      const bytes = new Uint8Array(await this.disk.readBinary(path))
      this.observedBases.set(this.pathKey(path), { sha: await sha256(bytes) })
      return bytes
    } catch (cause) {
      if (cause instanceof EngineError) throw cause
      throw new EngineError('io', `cannot read ${path}`, cause)
    }
  }

  [UPLOAD_READ](path: string, expected?: SourceStamp) {
    return this.io.openUploadRead(path, expected)
  }
  async openRead(path: string, expected?: SourceStamp) {
    return this.io.openRead(path, expected)
  }
  [Symbol.for('abele.sync.diagnostic-v1')](operation: string, startedAt: number, outcome: string) {
    this.diagnostic?.(operation, startedAt, outcome)
  }
  [Symbol.for('abele.sync.replay-stage-v1')]() {
    return this.io.canReplayStage()
  }
  async [FINGERPRINT_UPLOAD](
    path: string,
    consume: (identity: { size: number; sha: string }, source: ChunkSource) => Promise<void>,
    signal?: AbortSignal,
    acknowledged?: (identity: ContentIdentity) => boolean
  ) {
    const identity = await this.io.fingerprintForUpload(path, consume, signal, acknowledged)
    if (!identity) return undefined
    this.observedBases.set(this.pathKey(path), { sha: identity.sha })
    return { ...identity, mtime: stamp(identity.mtime) }
  }
  get [Symbol.for('abele.sync.scan-upload-source-v1')](): boolean {
    const native = nativeChunkPort(this.disk)
    return !!(native.open && native.fullPath)
  }
  async fingerprint(path: string, signal?: AbortSignal, fresh = false) {
    signal?.throwIfAborted()
    this.runtimeFence?.assertReady()
    const local = storageOf(this.app)
    const host = local ? durableHostOf(local) : undefined
    if (!host || !this.fileIdentity || !this.cacheableScanPath(path))
      return this.fingerprintFresh(path, signal)
    const key = this.pathKey(path)
    // A file can be indexed before its cohort commits and records its verified hash.
    // The watcher's own-write examination waits for that barrier instead of reading
    // freshly installed bytes while their receipt is still being made durable.
    const installing = fresh ? host.pendingScanInstallation(key) : undefined
    if (installing !== undefined) {
      if (!signal) await installing
      else {
        let abort!: () => void
        try {
          await Promise.race([
            installing,
            new Promise<never>((_resolve, reject) => {
              abort = () => reject(new SyncCancelled())
              signal.addEventListener('abort', abort, { once: true })
              if (signal.aborted) abort()
            }),
          ])
        } finally {
          signal.removeEventListener('abort', abort)
        }
      }
      signal?.throwIfAborted()
    }
    const revision = host.scanFingerprintRevision(key)
    const beforeIdentity = await this.fileIdentity(path)
    const before = await this.rawStat(path)
    if (!beforeIdentity || before?.type !== 'file') return this.fingerprintFresh(path, signal)
    let saved = await host.readScanFingerprint(key)
    const installed = host.scanInstallation(key)
    // A fresh watcher check bypasses durable scan hints, but not bytes just verified by
    // installation. Bind that receipt to the current identity below before using it.
    const fromInstall = installed !== undefined
    if (fromInstall) saved = installed
    const legacyKey = !saved && key !== path ? path : undefined
    if (legacyKey) saved = await host.readScanFingerprint(legacyKey)
    signal?.throwIfAborted()
    this.runtimeFence?.assertReady()
    if (
      (!fresh || fromInstall) &&
      saved?.identity === beforeIdentity &&
      saved.size === before.size &&
      saved.mtime === before.mtime &&
      saved.ctime === before.ctime &&
      (!saved.contentRevision ||
        saved.contentRevision === (await nativeOf(this.disk)?.fileContentRevision?.(path))) &&
      typeof saved.sha === 'string' &&
      /^[a-f0-9]{64}$/.test(saved.sha)
    ) {
      const after = await this.rawStat(path)
      if (
        after?.type === 'file' &&
        after.size === before.size &&
        after.mtime === before.mtime &&
        after.ctime === before.ctime &&
        (await this.fileIdentity(path)) === beforeIdentity &&
        (!saved.contentRevision ||
          saved.contentRevision === (await nativeOf(this.disk)?.fileContentRevision?.(path))) &&
        (!fromInstall || host.scanInstallation(key) === installed)
      ) {
        signal?.throwIfAborted()
        this.runtimeFence?.assertReady()
        if (fromInstall && !this.promotedInstallations.has(installed)) {
          await host.writeScanFingerprint(key, saved, revision)
          this.promotedInstallations.add(installed)
        }
        if (legacyKey) {
          await host.writeScanFingerprint(key, saved, revision)
          await host.withScanMutation([legacyKey], async () => {})
          signal?.throwIfAborted()
          this.runtimeFence?.assertReady()
        }
        this.observedBases.set(this.pathKey(path), { sha: saved.sha })
        return {
          sha: saved.sha,
          size: before.size,
          mtime: stamp(before.mtime),
          generation: `${before.size}:${before.mtime}:${before.ctime}`,
        }
      }
    }
    host.forgetScanInstallation(key)
    const result = await this.fingerprintFresh(path, signal)
    const after = await this.rawStat(path)
    const afterIdentity = await this.fileIdentity(path)
    signal?.throwIfAborted()
    this.runtimeFence?.assertReady()
    if (
      after?.type === 'file' &&
      result.size === before.size &&
      after.size === before.size &&
      after.mtime === before.mtime &&
      after.ctime === before.ctime &&
      afterIdentity === beforeIdentity
    )
      await host.writeScanFingerprint(
        key,
        {
          identity: beforeIdentity,
          size: before.size,
          mtime: before.mtime,
          ctime: before.ctime,
          sha: result.sha,
        },
        revision
      )
    signal?.throwIfAborted()
    this.runtimeFence?.assertReady()
    return result
  }
  [Symbol.for('abele.sync.path-admission-v1')](path: string) {
    const platform = Platform.isWin
      ? 'windows'
      : Platform.isAndroidApp
        ? 'android'
        : Platform.isIosApp
          ? 'ios'
          : Platform.isMacOS
            ? 'macos'
            : 'linux'
    const reason = unsupportedSyncName(path, platform)
    return reason
      ? { allowed: false, reason: 'unsupported-host-name: ' + reason }
      : { allowed: true }
  }
  private async fingerprintFresh(path: string, signal?: AbortSignal) {
    const identity = await this.io.fingerprint(path, signal, false, true)
    this.observedBases.set(this.pathKey(path), { sha: identity.sha })
    return { ...identity, mtime: stamp(identity.mtime) }
  }
  async [Symbol.for('abele.sync.cached-scan-hash-v1')](path: string) {
    this.runtimeFence?.assertReady()
    const cache = this.app.metadataCache as typeof this.app.metadataCache & {
      initialized?: boolean
      isCacheClean?: () => boolean
      getFileInfo?: (
        path: string
      ) => { hash?: unknown; size?: unknown; mtime?: unknown } | undefined
    }
    try {
      if (this.indexReady() === false) return null
      const row = cache.getFileInfo?.(path)
      if (!row || typeof row.hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.hash)) return null
      const { hash, size, mtime } = row
      const actual = await this.rawStat(path)
      if (!actual || actual.type !== 'file' || actual.size !== size || actual.mtime !== mtime) {
        this.indexFallback = true
        return null
      }
      if (this.indexReady() === false) return null
      const after = cache.getFileInfo?.(path)
      if (after?.hash !== hash || after.size !== size || after.mtime !== mtime) return null
      return { sha: hash, size: actual.size, mtime: stamp(actual.mtime) }
    } catch {
      // Optional host cache evidence is never required for a content scan.
      return null
    }
  }
  async [Symbol.for('abele.sync.fingerprint-fresh-v1')](path: string, signal?: AbortSignal) {
    return this.fingerprint(path, signal, true)
  }
  async [Symbol.for('abele.sync.fingerprint-pull-v1')](path: string) {
    let identity
    try {
      identity = await this.io.fingerprint(path, undefined, true)
    } catch (error) {
      if (!(error instanceof EngineError) || error.code !== 'conflict') throw error
      // A case-folding host may expose the same inode under the wire's new spelling.
      // Use the actual directory entry's live receipt, never a same-stat guess.
      const actual = await this.spellingOnDisk(path)
      if (!actual || actual === path) throw error
      identity = await this.io.fingerprint(actual, undefined, true)
    }
    this.observedBases.set(this.pathKey(path), { sha: identity.sha })
    // Native stats retain fractional milliseconds for source-generation checks.
    // The core identity must use the same wire date as stat/list and staged bases.
    return { ...identity, mtime: stamp(identity.mtime) }
  }
  async beginAtomicWrite(
    path: string,
    mtime: number,
    expectedBase: (ContentIdentity & { mtime?: number; identity?: string }) | null,
    beforeCreate?: (stageId: string) => Promise<void>
  ): Promise<AtomicStage> {
    this.runtimeFence?.assertReady()
    this.externalCoordination.assertEnginePaths([path])
    await makeParents(this.disk, path)
    const temp = await this.writer.freeName(path, 'tmp')
    // The durable core intent owns this opaque locator before any artifact exists.
    await beforeCreate?.(temp)
    const entry: JournalEntry = {
      target: path,
      temp,
      ...(path.startsWith((this.privateRoot ?? '.abele-sync') + '/placement-inbox/')
        ? { disposableSource: true }
        : {}),
      streaming: {
        mtime,
        base: expectedBase ? { ...expectedBase } : null,
      },
    }
    if (entry.disposableSource) reserveSourceStage(temp)
    this.stageOperations.add(temp)
    let ready = false
    try {
      await this.journal.persist(() => this.journal.add(entry))
      this.stages.set(temp, entry)
      await this.io.create(temp, mtime)
      if (this.native) await this.native.syncPath(temp, true)
      const stage = await this.reopenStage(temp)
      ready = true
      return stage
    } finally {
      this.stageOperations.delete(temp)
      if (!ready) releaseSourceStage(temp)
    }
  }
  /** Cleanup also works after removal reached disk but journal retirement did not. */
  async discardStage(id: string): Promise<void> {
    this.runtimeFence?.assertReady()
    const entry = await this.journal.currentEntry(id)
    if (this.stageOperations.has(id) || entry?.backup || entry?.retiredGeneration)
      throw new EngineError('io', 'stage is busy or awaiting recovery')
    this.stageOperations.add(id)
    try {
      const standing = await this.rawStat(id)
      if (standing !== null) {
        if (!entry?.streaming || standing.type !== 'file' || !(await this.journal.isCurrent(entry)))
          throw new EngineError('io', 'cannot discard an unowned stage')
        await this.disk.remove(id)
      }
      if (this.native) await this.native.syncPath(id, true)
      if (entry) await this.journal.persist(() => this.journal.drop(entry))
      this.stages.delete(id)
      releaseSourceStage(id)
    } finally {
      this.stageOperations.delete(id)
    }
  }
  async reopenStage(
    id: string
  ): Promise<AtomicStage & { readonly target: string; installed(): Promise<boolean> }> {
    let entry = await this.journal.currentEntry(id)
    const stat = await this.rawStat(id)
    if (!stat) throw Object.assign(new Error('streaming stage is missing'), { code: 'ENOENT' })
    if (!entry?.streaming || entry.backup || entry.retiredGeneration)
      throw new EngineError('io', 'streaming stage is unavailable or awaiting recovery')
    if (stat.type !== 'file') throw new EngineError('io', 'streaming stage is not a file')
    if (!this.stages.has(id) && this.native) {
      directEntryDurability(this.disk).resume([id])
      this.stages.set(id, entry)
    }
    let offset = stat.size,
      busy = false,
      finished = false
    const exclusive = async <T>(work: () => Promise<T>): Promise<T> => {
      if (busy || finished || this.stageOperations.has(id))
        throw new EngineError('io', 'stage is busy or closed')
      busy = true
      this.stageOperations.add(id)
      try {
        this.runtimeFence?.assertReady()
        const current = await this.journal.currentEntry(id)
        if (
          !current ||
          current.backup ||
          current.retiredGeneration ||
          JSON.stringify(current) !== JSON.stringify(entry)
        )
          throw new EngineError('io', 'stage publication is awaiting recovery')
        return await work()
      } finally {
        busy = false
        this.stageOperations.delete(id)
      }
    }
    return {
      id,
      target: entry.target,
      installed: async () => {
        const native = this.native
        if (!(await this.journal.isCurrent(entry))) return false
        if (!entry.streaming.sealed || !native?.sameObject) return false
        try {
          const installed =
            (await native.sameObject(id, entry.target)) &&
            (await this.io.fingerprint(entry.target, undefined, true)).sha ===
              entry.streaming.sealed.sha &&
            (await native.sameObject(id, entry.target))
          if (installed) await native.syncPath(entry.target)
          return installed
        } catch (error) {
          if ((error as { code?: string }).code === 'ENOENT') return false
          throw error
        }
      },
      get offset() {
        return offset
      },
      append: (at, bytes, signal) =>
        exclusive(async () => {
          if (entry.streaming.sealed || at !== offset)
            throw new EngineError('io', 'invalid staging append')
          try {
            await this.io.append(id, offset, bytes, entry.streaming.mtime, signal)
          } finally {
            const standing = await this.rawStat(id)
            if (standing?.type === 'file') offset = standing.size
          }
        }),
      seal: (expected) =>
        exclusive(async () => {
          const identity = await this.io.fingerprint(id, undefined, true)
          if (identity.size !== expected.size || identity.sha !== expected.sha)
            throw new EngineError('protocol', 'streaming stage integrity mismatch')
          const sealed = {
            ...entry,
            replacementSha: expected.sha,
            streaming: { ...entry.streaming, sealed: { size: expected.size, sha: expected.sha } },
          }
          await this.journal.persist(() => this.journal.replace(entry, sealed))
          entry = sealed
          this.stages.set(id, sealed)
        }),
      commit: (signal) =>
        exclusive(async () => {
          signal?.throwIfAborted()
          const release = this.externalCoordination.beginEngineMutation([entry.target])
          try {
            await this.beforeEngineMutation?.([entry.target])
            signal?.throwIfAborted()
            if (entry.streaming.retainBase || entry.streaming.retainedBackup) {
              let backup = entry.streaming.retainedBackup
              if (!backup && (await this.rawStat(entry.target))) {
                backup = await this.writer.freeName(entry.target, 'old')
                const next = { ...entry, streaming: { ...entry.streaming, retainedBackup: backup } }
                await this.journal.persist(() => this.journal.replace(entry, next))
                entry = next
                this.stages.set(id, entry)
              }
              if (backup) {
                if (
                  !(await this.rawStat(backup)) &&
                  !(await this.conditional.retainUncertain(entry.target, backup))
                )
                  throw new EngineError('conflict', 'Recovery target could not be retained')
                await this.journal.persist(() => this.journal.preserve({ ...entry, backup }))
              }
              const streaming = { ...entry.streaming, retainBase: false }
              delete streaming.retainedBackup
              const next = { ...entry, streaming }
              await this.journal.persist(() => this.journal.replace(entry, next))
              entry = next
              this.stages.set(id, entry)
            }
            const base = entry.streaming.base
            if (base && base.mtime === undefined)
              throw new EngineError('conflict', 'stage base has no modification time')
            if (
              !(await this.conditionalFile({
                path: entry.target,
                expected: base ? { ...base, mtime: base.mtime } : null,
                effect: { kind: 'install', stageId: id },
              }))
            )
              throw new EngineError('conflict', 'stage target changed before publication')
            this.stages.delete(id)
            await this.io.adoptReceipt(id, entry.target)
            this.observedBases.delete(this.pathKey(entry.target))
            finished = true
            releaseSourceStage(id)
          } finally {
            release()
          }
        }),
      discard: () =>
        finished
          ? this.discardStage(id)
          : exclusive(async () => {
              if ((await this.rawStat(id)) !== null) await this.disk.remove(id)
              if (this.native) await this.native.syncPath(id, true)
              await this.journal.persist(() => this.journal.drop(entry))
              this.stages.delete(id)
              finished = true
            }).finally(() => releaseSourceStage(id)),
    }
  }

  /** Only the core's matching immutable pull intent may restart an unreadable private stage. */
  [Symbol.for('abele.sync.reopen-pull-stage-v1')](id: string) {
    return this.reopenPullStage(id)
  }
  private async reopenPullStage(id: string) {
    const stage = await this.reopenStage(id)
    if (await this.io.canResumeStage(id)) return stage
    const entry = await this.journal.currentEntry(id)
    if (!entry?.streaming || entry.backup || this.stageOperations.has(id))
      throw new EngineError('io', 'pull stage cannot restart during publication')
    const restarted: JournalEntry = {
      ...entry,
      replacementSha: undefined,
      streaming: { ...entry.streaming, sealed: undefined },
    }
    // Retire the old seal before truncating only this journal-owned private download.
    // No persisted digest authenticates bytes left by a previous process.
    await this.journal.persist(() => this.journal.replace(entry, restarted))
    this.stages.set(id, restarted)
    await this.io.create(id, entry.streaming.mtime)
    console.debug('[abele-sync] restarting private pull stage without local range reads')
    return this.reopenStage(id)
  }

  [Symbol.for('abele.sync.live-source-stage-v1')]<T>(id: string, work: () => Promise<T>) {
    return this.writer.holding(id, work)
  }

  /** A matching pull intent outlived publication. Never infer the installed bytes' identity. */
  async [Symbol.for('abele.sync.recover-published-pull-v1')](
    id: string | null,
    target: string,
    mtime: number,
    from: string | null = null,
    beforeCreate?: (id: string) => Promise<void>,
    expectedBase?: { sha: string; size: number; mtime: number; identity?: string } | null,
    receiptId?: string
  ) {
    const previous = id ? await this.journal.currentEntry(id) : undefined
    // A still-private checked stage has not been published. Native stages retain
    // an alias: only matching object identity proves that alias reached the target.
    // Keep the original base for known-unpublished work, including allocation cuts.
    if (expectedBase !== undefined) {
      let uncertain = !!previous
      if (id && (await this.disk.exists(id))) {
        if (!previous?.streaming || previous.backup)
          throw new EngineError('io', 'pull stage is unavailable or awaiting backup recovery')
        uncertain = false
        if (this.native?.sameObject) {
          try {
            uncertain = await this.native.sameObject(id, target)
          } catch (error) {
            if ((error as { code?: string }).code !== 'ENOENT') throw error
          }
        }
        if (!uncertain) {
          // The private stage proves non-publication, not continued ownership of
          // the target. Preserve a save made since the interrupted download.
          // A still-present distinct source remains the core's recreation decision.
          const current = await this.rawStat(target)
          let retain = false
          if (
            current &&
            (from === null ||
              this.pathKey(from) === this.pathKey(target) ||
              (await this.rawStat(from)) === null)
          ) {
            retain =
              expectedBase === null ||
              current.size !== expectedBase.size ||
              current.mtime !== expectedBase.mtime
            if (!retain && expectedBase !== null) {
              try {
                retain =
                  (await this.io.fingerprint(target, undefined, true, true)).sha !==
                  expectedBase.sha
              } catch (error) {
                if (!(error instanceof EngineError) || error.code !== 'conflict' || error.cause)
                  throw error
                // Inability to verify authorizes preservation, never equality or removal.
                retain = true
              }
            }
          }
          // Recovery may detach an independently recreated source and authorize
          // installation into an absent destination. The old stage's source base
          // must not require that absent target to exist; conditional install still
          // checks absence again at publication.
          const absentBase = !current && expectedBase === null && from === null
          if (retain || absentBase) {
            const retained: JournalEntry = {
              ...previous,
              streaming: { ...previous.streaming, base: null, retainBase: retain },
            }
            await this.journal.persist(() => this.journal.replace(previous, retained))
            this.stages.set(id, retained)
            console.debug(
              '[abele-sync]',
              retain
                ? 'preserving a target saved during interrupted download'
                : 'recovering private stage into absent target'
            )
          }
          return this.reopenPullStage(id)
        }
      } else if (!id && receiptId) {
        const receipt = (await this.journal.currentForTargets([target])).find(
          (entry) => entry.conditionalReceipt === receiptId
        )
        uncertain = !!receipt
        if (receipt?.temp && (await this.disk.exists(receipt.temp))) {
          uncertain = false
          if (this.native?.sameObject) {
            try {
              uncertain = await this.native.sameObject(receipt.temp, target)
            } catch (error) {
              if ((error as { code?: string }).code !== 'ENOENT') throw error
            }
          }
        }
      }
      if (!uncertain) return this.beginAtomicWrite(target, mtime, expectedBase, beforeCreate)
    }
    if (id && (await this.disk.exists(id))) {
      if (!previous?.streaming || previous.backup)
        throw new EngineError('io', 'pull stage is unavailable or awaiting backup recovery')
      // An intent authorizes the incoming version, not bytes saved locally since the crash.
      // Retain either the destination or the source about to move there, on both host shapes.
      const installed = (await this.rawStat(target)) ?? (from ? await this.rawStat(from) : null)
      const retained: JournalEntry = {
        ...previous,
        streaming: { ...previous.streaming, base: null, retainBase: installed !== null },
      }
      await this.journal.persist(() => this.journal.replace(previous, retained))
      this.stages.set(id, retained)
      return this.reopenPullStage(id)
    }
    if (previous?.backup)
      throw new EngineError('io', 'pull publication is awaiting backup recovery')
    const stage = await this.beginAtomicWrite(target, mtime, null, beforeCreate)
    const entry = await this.journal.currentEntry(stage.id)
    if (!entry?.streaming) throw new EngineError('io', 'Recovery download stage lost its journal')
    if ((await this.rawStat(target)) ?? (from ? await this.rawStat(from) : null)) {
      const retained: JournalEntry = {
        ...entry,
        streaming: { ...entry.streaming, retainBase: true },
      }
      await this.journal.persist(() => this.journal.replace(entry, retained))
      this.stages.set(stage.id, retained)
    }
    if (previous) await this.journal.persist(() => this.journal.drop(previous))
    console.debug('[abele-sync] redownloading published pull while retaining uncertain local bytes')
    return this.reopenStage(stage.id)
  }

  async writeAtomic(path: string, bytes: Uint8Array, mtime: number): Promise<void> {
    this.runtimeFence?.assertReady()
    this.writtenStat = null
    const release = this.externalCoordination.beginEngineMutation([path])
    try {
      await this.writeUnreserved(path, bytes, mtime)
      // Record only a successful publication. A later local edit must differ from this
      // baseline on the next scan, rather than being adopted as part of our write.
      this.writtenStat = { path, size: bytes.length, mtime }
    } catch (error) {
      if (
        error instanceof EngineError ||
        (error instanceof Error && error.name === 'SyncCancelled')
      )
        throw error
      throw new EngineError(
        'io',
        `cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    } finally {
      release()
    }
  }

  private async legacyBase(path: string) {
    const observed = this.observedBases.get(this.pathKey(path))
    if (observed && 'absent' in observed) return null
    const standing = await this.onlyFileOrNothing(path)
    if (standing === null) return null
    // Scan hints may survive a same-stat edit. Mutation authority requires bytes.
    const have = await this.fingerprint(path, undefined, true)
    if (observed && 'sha' in observed && observed.sha !== have.sha) {
      this.observedBases.set(this.pathKey(path), observed)
      throw new EngineError('conflict', 'File changed since the engine byte decision')
    }
    return { size: have.size, mtime: have.mtime, sha: have.sha }
  }

  private async writeUnreserved(path: string, bytes: Uint8Array, mtime: number): Promise<void> {
    this.runtimeFence?.assertReady()
    const expected = await this.legacyBase(path)
    const target = expected === null ? path : await this.writer.held(path)
    await this.beforeEngineMutation?.([target])
    if (
      !(await this.conditionalFile({
        path: target,
        expected,
        effect: { kind: 'write', bytes, mtime },
      }))
    )
      throw new EngineError('conflict', 'File changed before publication')
    this.observedBases.delete(this.pathKey(path))
  }

  async move(from: string, to: string): Promise<void> {
    this.runtimeFence?.assertReady()
    this.externalCoordination.assertEnginePaths([from, to])
    const expected = await this.legacyBase(from)
    if (expected === null) {
      await this.onlyFileOrNothing(from)
      throw new EngineError('io', 'Move source is absent')
    }
    await this.onlyFileOrNothing(to)
    if (from === to) return
    await this.beforeEngineMutation?.([from, to])
    if (!(await this.conditionalFile({ path: from, expected, effect: { kind: 'move', to } })))
      throw new EngineError('conflict', 'File changed before move')
  }

  async remove(path: string): Promise<void> {
    this.runtimeFence?.assertReady()
    this.externalCoordination.assertEnginePaths([path])
    const expected = await this.legacyBase(path)
    if (expected === null) {
      if (await this.onlyFileOrNothing(path))
        throw new EngineError('conflict', 'File appeared before removal')
      return
    }
    await this.beforeEngineMutation?.([path])
    if (!(await this.conditionalFile({ path, expected, effect: { kind: 'remove' } })))
      throw new EngineError('conflict', 'File changed before removal')
  }

  /** Tell the host what the engine changed on disk (`onEngineWrite`). */
  private wrote(paths: readonly string[], known?: 'file' | null): void {
    if (paths.some((path) => this.inventoryVisible(path) && this.withinFileScope(path)))
      this.scanWatchRevision++
    this.invalidateRootChain(paths)
    this.updateInventory(paths, known)
    for (const path of paths) {
      const parent = known === 'file' ? folderOf(path).replace(/^\/$/, '') : path
      if (known === 'file' && this.inventory?.directories !== undefined) {
        // Publication proves these parents exist. Expose membership immediately, but batch
        // their durable birth/identity reads before directory inventory is consumed again.
        const inventory = this.inventory
        inventory.publishedParents ??= new Set()
        const parts = parent.split('/')
        for (let length = 1; length <= parts.length; length++) {
          const prefix = parts.slice(0, length).join('/')
          if (!prefix || !this.withinFileScope(prefix) || inventory.publishedParents.has(prefix))
            continue
          inventory.publishedParents.add(prefix)
          const containing = folderOf(prefix).replace(/^\/$/, '')
          inventory.indexedChildren.delete(containing)
          const listing = inventory.listings.get(containing)
          if (listing !== undefined)
            inventory.listings.set(
              containing,
              listing.then((before) => ({
                files: before.files,
                folders: [...new Set([...before.folders, prefix])],
              }))
            )
          const children = inventory.children.get(containing)
          if (children !== undefined)
            inventory.children.set(
              containing,
              children.then((before) =>
                before.some((one) => one.path === prefix)
                  ? before
                  : [...before, { path: prefix, kind: 'directory' as const }]
              )
            )
        }
      } else {
        void this.rememberInventoryParents(parent).catch((error) =>
          console.debug('[abele-sync] inventory update failed', error)
        )
      }
    }

    if (paths.some((path) => path.startsWith(this.configDir + '/'))) this.configInventory = null
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
    if (info === null) this.observedBases.set(this.pathKey(path), { absent: true })
    return info === null ? null : this.told(info, false)
  }

  /** The file at `path` as the disk has it, before `told`; null for none, or not a file. */
  private async fileAt(path: string): Promise<FileInfo | null> {
    const indexed = this.app.vault.getFileByPath(path)
    if (indexed && this.indexReady() !== false && !this.awaitingIndex.has(path))
      return { path, size: indexed.stat.size, mtime: stamp(indexed.stat.mtime) }
    const operation = this.operationStats
    if (operation && operation.revision !== this.operationRevision()) {
      operation.cache.clear()
      operation.revision = this.operationRevision()
    }
    const read = () => {
      if (!operation) return this.rawStat(path)
      let known = operation.cache.get(path)
      if (known === undefined) operation.cache.set(path, (known = this.rawStat(path)))
      return known
    }
    const standing = this.inventory
      ? await this.inventory.stats.stable(path, () => this.rawStat(path))
      : await read()
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
  private scanWatchers = 0
  private scanWatchRevision = 0;
  /** Foreground inspection retires a proof even when no file event was available. */
  [Symbol.for('abele.sync.invalidate-local-scan-v1')](watchGap = true): void {
    this.scanWatchRevision++
    if (watchGap) this.watchEpoch = undefined
  }

  // The watcher's per-path change clock. Unlike an inventory pass it spans engine cycles, so
  // an advisory decision verified once stands until an event names the file or a folder above
  // it. Every epoch starts with watching and ends after WATCH_PROOF_MS.
  private watchEpoch: number | undefined
  private watchEpochAt = 0
  private watchClock = 0
  private watchFloor = 0
  private readonly watchChanges = new Map<string, number>()
  private noteWatchChange(path: string): void {
    const key = this.pathKey(path)
    if (!this.watchChanges.has(key) && this.watchChanges.size >= 65536) {
      this.watchChanges.clear()
      this.watchFloor = this.watchClock + 1
    }
    this.watchChanges.set(key, ++this.watchClock)
  }
  [Symbol.for('abele.sync.watch-epoch-v1')](): number | undefined {
    if (!this.scanWatchers) return undefined
    const now = Date.now()
    if (
      this.watchEpoch === undefined ||
      now < this.watchEpochAt ||
      now - this.watchEpochAt >= WATCH_PROOF_MS
    ) {
      this.watchEpoch = ++watchEpochs
      this.watchEpochAt = now
      this.watchChanges.clear()
      this.watchFloor = ++this.watchClock
    }
    return this.watchEpoch
  }
  /** The change clock of `path` and its folders in the current epoch. The config folder is
   * polled rather than watched, so it has none. */
  [Symbol.for('abele.sync.watch-revision-v1')](path: string): number | undefined {
    if (!this.scanWatchers || this.watchEpoch === undefined) return undefined
    const key = this.pathKey(path)
    if (withinRoot(key, this.pathKey(this.configDir))) return undefined
    return this.watchPathRevision(key)
  }
  private watchPathRevision(key: string): number {
    let revision = this.watchFloor
    for (let current = key; current; current = current.slice(0, current.lastIndexOf('/'))) {
      revision = Math.max(revision, this.watchChanges.get(current) ?? 0)
      if (!current.includes('/')) break
    }
    return revision
  }

  [Symbol.for('abele.sync.local-scan-revision-v1')](): string | undefined {
    return this.scanWatchers
      ? `${this.scanWatchRevision}:${folderMutations(this.app.vault).revision}`
      : undefined
  }
  watch(cb: (paths: string[]) => void): () => void {
    this.runtimeFence?.assertReady()
    if (this.scanWatchers++ === 0) {
      this.scanWatchRevision++
      this.watchEpoch = undefined
      this.rootChain = undefined
    }
    const changed = (file: { path: string }, mutation = false) => {
      const local = storageOf(this.app)
      // Index notifications also arrive after our own publication. Keep the receipt until
      // the identity/stat check examines it; an observed adapter mutation retires it now.
      if (local) {
        const host = durableHostOf(local)
        const key = this.pathKey(file.path)
        if (mutation || !host?.scanInstallation(key)?.contentRevision)
          host?.invalidateScanInstallations([key])
      }
      this.noteWatchChange(file.path)
      if (this.inventoryVisible(file.path) && this.withinFileScope(file.path))
        this.scanWatchRevision++
    }
    // Observe adapter changes before their promises resolve, including config writes without
    // vault events. Device-local journals/settings cannot invalidate an unchanged sync set.
    // A scoped port can retain its own wrappers; user writes arrive on the vault adapter.
    const stopScanChanges = observeAdapterConfig(vaultDisk(this.app.vault), '', (paths) => {
      for (const path of paths) changed({ path }, true)
    })
    const rootChanges = [
      this.app.vault.on('create', (file) => {
        changed(file)
        this.invalidateRootChain([file.path])
      }),
      this.app.vault.on('modify', (file) => changed(file)),
      this.app.vault.on('delete', (file) => {
        changed(file)
        this.invalidateRootChain([file.path])
      }),
    ]
    const directoryRename = this.app.vault.on('rename', (file, previous) => {
      changed(file)
      changed({ path: previous })
      this.invalidateRootChain([previous, file.path])
      if ('children' in file && this.withinFileScope(previous) && this.withinFileScope(file.path))
        this.directories.renamed(previous, file.path)
    })
    const stopMutations = folderMutations(this.app.vault).watch()
    const watcher = watchVault(
      {
        app: this.app,
        now: this.now,
        onWatch: this.onWatch
          ? (paths) =>
              this.onWatch(
                paths.filter(
                  (path) =>
                    path === IGNORE_FILE ||
                    (this.inventoryVisible(path) && this.withinFileScope(path))
                )
              )
          : null,
        pollMs: this.pollMs,
        configDir: this.configDir,
        snapshot: () => this.configSnapshot(),
      },
      (paths) => {
        for (const path of paths) this.noteWatchChange(path)
        if (
          paths.some(
            (path) =>
              path === IGNORE_FILE || (this.inventoryVisible(path) && this.withinFileScope(path))
          )
        )
          this.scanWatchRevision++
        cb(
          paths.filter(
            (path) =>
              path === IGNORE_FILE || (this.inventoryVisible(path) && this.withinFileScope(path))
          )
        )
      }
    )
    this.pollNow = watcher.kick
    this.inspectPoll = watcher.inspect
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      this.scanWatchers--
      if (!this.scanWatchers) {
        this.scanWatchRevision++
        this.watchEpoch = undefined
        this.rootChain = undefined
      }
      watcher.stop()
      stopScanChanges()
      this.app.vault.offref(directoryRename)
      for (const ref of rootChanges) this.app.vault.offref(ref)
      stopMutations()
      if (this.pollNow === watcher.kick) this.pollNow = null
      if (this.inspectPoll === watcher.inspect) this.inspectPoll = null
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
  /** Watcher proofs cover ordinary files; settings and ignore metadata need a fresh poll. */
  [Symbol.for('abele.sync.inspect-polled-v1')](): Promise<boolean> {
    return this.inspectPoll?.() ?? Promise.resolve(false)
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
    if (isDeviceLocalPluginState(folder, this.configDir)) return
    if (depth > CONFIG_WALK_DEPTH || walked.has(folder)) {
      console.debug(`[abele-sync] not following ${folder} any further`)
      return
    }
    walked.add(folder)

    let listed: ListedFiles
    try {
      listed = await this.inventoryListing(folder)
    } catch (cause) {
      // Asked only when the listing failed, which is the one moment the answer matters.
      if (!(await this.there(folder))) return
      throw new EngineError('io', `cannot list ${folder}`, cause)
    }
    for (const path of listed.files) {
      if (isAdapterTemp(path)) {
        // A temp of new bytes a killed write left behind goes; a backup is somebody's only
        // copy, and the write journal puts it back.
        if (
          isDroppableTemp(path) &&
          !this.stages.has(path) &&
          !(await this.journal.currentRetainsTemp(path))
        )
          await this.sweep(path)
        continue
      }
      if (isDeviceLocalPluginState(path, this.configDir)) continue
      const info = await this.fileAt(path)
      if (info !== null) yield info
    }
    for (const child of listed.folders) yield* this.walkConfig(child, depth + 1, walked)
  }

  private async sweep(path: string): Promise<void> {
    try {
      await this.disk.remove(path)
      console.debug(`[abele-sync] removed ${path}, left by a write that did not finish`)
    } catch (error) {
      console.debug(`[abele-sync] could not remove ${path}`, error)
    }
  }

  /** Whether the path is there; a question that cannot be answered is answered with yes. */
  private async there(path: string): Promise<boolean> {
    try {
      return await this.disk.exists(path)
    } catch {
      return true
    }
  }

  /**
   * Poll the same metadata/object identity used by normal fingerprints. Native metadata
   * change time additionally detects in-place writes that restore their modification time.
   *
   * The ignore file is polled explicitly: it is neither in the file index nor under
   * the config folder, so no vault event reports an external edit to it.
   */
  private async configSnapshot(): Promise<Map<string, string>> {
    if (this.configPolled) {
      this.operationStats?.cache.clear()
      invalidateInspectedAbsence(this.startupInventory?.())
      directEntryDurability(this.disk).forgetDirectories()
      this.io.invalidateCapabilities()
      if (this.inventory) this.inventory.pollRevision = ++this.inventory.localRevision
    }
    const taken = new Map<string, string>()
    if (this.scopedRoot() || this.discovery) {
      this.configPolled = true
      const ignore = await this.fileSnapshot(IGNORE_FILE)
      if (ignore !== null) taken.set(IGNORE_FILE, ignore)
      return taken
    }
    if (!this.configPolled && this.configInventory === null && !this.inventoryConsumed) {
      const inventory = this.startupConfigInventory()
      this.inventoryConsumed = true
      this.configInventory = inventory ?? (await this.readConfigInventory())
    } else if (this.configPolled || this.configInventory === null) {
      this.configInventory = await this.readConfigInventory()
    }
    this.configPolled = true
    for (const info of this.configInventory) {
      const signature = await this.fileSnapshot(info.path)
      if (signature !== null) taken.set(info.path, signature)
    }
    const ignore = await this.fileSnapshot(IGNORE_FILE)
    if (ignore !== null) taken.set(IGNORE_FILE, ignore)
    return taken
  }

  /** Fresh facts, never index/listing hints or wire-rounded dates. Shared with config
   * yield observations so an equal-length replacement cannot keep an old baseline.
   */
  private async fileSnapshot(path: string): Promise<string | null> {
    const stat = await this.rawStat(path)
    if (stat?.type !== 'file') return null
    // The ignore file is host metadata, deliberately outside the public file port.
    const readIdentity = () =>
      path === IGNORE_FILE ? this.native?.fileIdentity?.(path) : this.fileIdentity?.(path)
    const identity = await readIdentity()
    const changed = await retainedFileStat(this.disk, path)
    if (changed?.type !== 'file') return null
    const after = await this.rawStat(path)
    if (
      !after ||
      after.type !== 'file' ||
      stat.size !== after.size ||
      stat.mtime !== after.mtime ||
      stat.ctime !== after.ctime ||
      changed.size !== after.size ||
      changed.mtime !== after.mtime ||
      identity !== (await readIdentity())
    )
      throw new EngineError('conflict', 'File changed while polling metadata')
    return JSON.stringify([stat.size, stat.mtime, stat.ctime, identity ?? null, changed.ctime])
  }
  private async readConfigInventory(): Promise<FileInfo[]> {
    const files: FileInfo[] = []
    for await (const info of this.walkConfig(this.configDir)) files.push(info)
    return files
  }

  private async isSymlink(path: string): Promise<boolean> {
    const root = this.scopedRoot()
    const rootSymlink = Reflect.get(this.scopedAdapter, CONNECTION_ROOT_SYMLINK) as
      | (() => Promise<boolean>)
      | undefined
    if (root && rootSymlink) {
      // These are synthetic scaffolding in the scoped port. The root check below
      // validates their real chain without exporting their paths to general callers.
      if (root.startsWith(path + '/')) return false
      if (path === root) {
        if (this.rootChain?.root !== root) this.rootChain = { root, linked: rootSymlink() }
        return this.rootChain.linked
      }
    }
    return vaultPathIsLink(this.disk, path)
  }

  /** Watchers and scans share this cache; their startup order must not change wire metadata. */
  private startupConfigInventory(): FileInfo[] | undefined {
    const inventory = this.startupInventory?.()
    return (
      inventory &&
      [...inventory.values()]
        .filter(
          (info) =>
            info.path.startsWith(this.configDir + '/') &&
            !isAdapterTemp(info.path) &&
            !isDeviceLocalPluginState(info.path, this.configDir)
        )
        .map((info) => ({ ...info, mtime: stamp(info.mtime) }))
    )
  }

  private async spellingOnDisk(path: string): Promise<string | null> {
    if (this.discovery && this.discovery.roots.length === 0)
      return (
        this.app.vault.getFileByPath(path)?.path ?? (this.awaitingIndex.has(path) ? path : null)
      )
    const cut = path.lastIndexOf('/')
    const parent = cut === -1 ? '' : path.slice(0, cut)
    try {
      const listing = await this.inventoryListing(parent)
      return listing.files.includes(path)
        ? path
        : (listing.files.find((file) => this.pathKey(file) === this.pathKey(path)) ?? null)
    } catch (cause) {
      if (notFound(cause)) {
        return null
      }
      throw new EngineError('io', `cannot list ${parent}`, cause)
    }
  }

  private async rawStat(target: string): Promise<Stat | null> {
    try {
      return await this.disk.stat(target)
    } catch (cause) {
      if (notFound(cause)) return null
      if (cause instanceof EngineError) throw cause
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
   * Both case and Unicode spelling must match the actual listed path. A listing that failed
   * is *not* a no: read as one, a rename that has already happened would be sent round again
   * and reported as a conflict the vault would hold for ever.
   */
  private async spelledExactly(target: string): Promise<boolean | null> {
    const wanted = target
    try {
      const listed = await this.disk.list(folderOf(target))
      return listed.files.some((held) => held === wanted)
    } catch {
      return null
    }
  }
}

/** The folder holding `target`; `/` for a file at the root, which is what `list` takes. */
function folderOf(target: string): string {
  const cut = target.lastIndexOf('/')
  return cut === -1 ? '/' : target.slice(0, cut)
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
