import { FINGERPRINT_UPLOAD, UPLOAD_READ } from './mobileWholeRead'
import { privatePlacementStages, PRIVATE_PLACEMENT_STAGES } from './privatePlacementStages'
import { isDeviceLocalPluginState } from './deviceLocalState'
import { nativeChunkPort, connectionFilePort, vaultPathIsLink } from './vaultPathLinks'
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
import { TFile, TFolder } from 'obsidian'
import {
  EngineError,
  MAX_CHUNK_BYTES,
  readReconciliation,
  requestReconciliation,
  type FileInfo,
  type FileSystem,
  type StateStore,
  type AtomicStage,
  type ContentIdentity,
  type ChunkSource,
  type SourceStamp,
} from '@abele/sync-sdk/core'
import { BoundedVaultIo } from './boundedVaultIo'
import { nativeDiagnostics } from './nativeDiagnostics'
import type { JournalEntry } from './writeJournal'
import { caseKey } from '@abele/sync-sdk/protocol'
import { watchVault } from './vaultWatcher'
import { fencedPort, type RuntimeFence } from './external/recovery'
import { stagingDirectory } from './stagingDirectory'
import { externalCoordinationOf } from './external/ObsidianExternalFileHost'
import type { ExternalFileCoordination } from './external/coordination'
import { folderMutations } from './folderMutations'
import { adapterConfigRevision } from './adapterConfigChanges'
import { pathCoordinatorOf } from './pathCoordinator'
import type { LocalStorage } from './ledgerId'
import { makeParents, pruneAbove } from './vaultFolders'
import { VaultDirectories } from './vaultDirectories'
import {
  isAdapterTemp,
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

/**
 * The vault's ignore file. It lives at the root rather than under the config folder, and a
 * leading dot keeps it out of Obsidian's file index, so nothing but this poll would ever
 * notice it being edited.
 */
const IGNORE_FILE = '.abele-sync-ignore'
const stageOperations = new WeakMap<object, Set<string>>()
type DirectoryInfo = { path: string; identity: string; mtime: number }
type InventoryChild = { path: string; kind: 'file' | 'directory'; identity?: string }
interface InventoryPass {
  indexedNames?: Map<string, Set<string>>
  parentFolders?: Set<string>
  publishedParents?: Set<string>
  directories?: Promise<DirectoryInfo[]>
  listings: Map<string, Promise<ListedFiles>>
  mutations: Set<string>
  children: Map<string, Promise<InventoryChild[]>>
  indexedChildren: Map<string, Promise<InventoryChild[]>>
}
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
  private readonly diagnostic?: ObsidianFileSystemOptions['diagnostic']
  private readonly fileScope?: ObsidianFileSystemOptions['fileScope']
  private inventory: InventoryPass | null = null
  private inventoryDepth = 0
  private writtenStat: FileInfo | null = null

  async [Symbol.for('abele.sync.index-absent-v1')](path: string): Promise<boolean> {
    this.runtimeFence?.assertReady()
    // This is a preflight hint, never permission to publish. The raw target check
    // under the placement lease still protects files that have not reached the index.
    if (!this.inventory || this.awaitingIndex.has(path) || this.inventory.mutations.has(path))
      return false
    if (this.app.vault.getAbstractFileByPath(path)) return false
    const parent = this.app.vault.getAbstractFileByPath(folderOf(path))
    if (!(parent instanceof TFolder)) return false
    const cache = (this.inventory.indexedNames ??= new Map())
    let names = cache.get(parent.path)
    if (names === undefined) {
      names = new Set(parent.children.map((child) => caseKey(child.path)))
      cache.set(parent.path, names)
    }
    return !names.has(caseKey(path))
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

  async [Symbol.for('abele.sync.inventory-pass-v1')]<T>(work: () => Promise<T>): Promise<T> {
    // Shared filesystem instances may have overlapping engines. Never share their snapshots.
    this.inventory =
      ++this.inventoryDepth === 1
        ? {
            listings: new Map(),
            mutations: new Set(),
            children: new Map(),
            indexedChildren: new Map(),
          }
        : null
    const inventory = this.inventory
    const invalidate = (
      file: { path: string; children?: unknown[] },
      previous?: string,
      created = false
    ) => {
      this.invalidateRootChain([file.path, ...(previous ? [previous] : [])])
      if (!inventory) return
      for (const path of [file.path, ...(previous ? [previous] : [])]) {
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
          inventory.directories = undefined
          for (const parent of inventory.publishedParents ?? [])
            if (parent === path || parent.startsWith(path + '/'))
              inventory.publishedParents?.delete(parent)
        }
      }
    }
    const refs = [
      this.app.vault.on('create', (file) => invalidate(file, undefined, true)),
      this.app.vault.on('delete', (file) => invalidate(file)),
      this.app.vault.on('rename', (file, previous) => invalidate(file, previous)),
    ]
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
        this.inventoryDepth--
        this.inventory = null
      }
    }
  }
  async [INVENTORY_DIRECTORIES](settle = false): Promise<DirectoryInfo[]> {
    if (settle) await this.settleInventoryParents()
    const read = async () => {
      const result = []
      for await (const directory of this.listDirectories()) result.push(directory)
      return result
    }
    if (!this.inventory) return read()
    return (this.inventory.directories ??= read())
  }
  async [Symbol.for('abele.sync.inventory-children-v1')](
    parent: string,
    target: string,
    filesOnly = false
  ): Promise<InventoryChild[]> {
    const inventory = this.inventory
    if (!inventory || normalizationPossible(target) || inventory.listings.has(parent))
      return this.listChildren(parent)
    let children = filesOnly ? undefined : inventory.indexedChildren.get(parent)
    if (children === undefined) {
      children = (async () => {
        // Download preflight needs only file membership, not directory identities.
        // Do not populate the full placement inventory with this narrower snapshot.
        const indexedOnly = filesOnly && !target.split('/').some((part) => part.startsWith('.'))
        const directories = indexedOnly ? [] : await this[INVENTORY_DIRECTORIES]()
        // Discovery may itself have revealed a Unicode alias at this parent.
        if (inventory.listings.has(parent)) return this.listChildren(parent)
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
          ...[...(inventory.publishedParents ?? [])]
            .filter(
              (path) =>
                folderOf(path).replace(/^\/$/, '') === parent &&
                !directories.some((one) => one.path === path)
            )
            .map((path) => ({ path, kind: 'directory' as const })),
          ...directories
            .filter((one) => folderOf(one.path).replace(/^\/$/, '') === parent)
            .map((one) => ({ path: one.path, kind: 'directory' as const, identity: one.identity })),
        ]
      })()
      if (!filesOnly) inventory.indexedChildren.set(parent, children)
    }
    return (await children).map((one) => ({ ...one }))
  }
  private inventoryListing(parent: string): Promise<ListedFiles> {
    const prior = this.inventory?.listings.get(parent)
    if (prior !== undefined) return prior
    const inventory = this.inventory
    const listing = this.disk.list(parent).catch((error): ListedFiles => {
      if (notFound(error)) return { files: [], folders: [] }
      if (inventory?.listings.get(parent) === listing) inventory.listings.delete(parent)
      throw error
    })
    this.inventory?.listings.set(parent, listing)
    return listing
  }
  private updateInventory(paths: readonly string[], known?: 'file' | null): void {
    const inventory = this.inventory
    if (!inventory) return
    for (const path of paths) {
      const parent = folderOf(path) === '/' ? '' : folderOf(path)
      if (known === 'file') inventory.indexedNames?.get(parent)?.add(caseKey(path))
      else inventory.indexedNames?.delete(parent)
      if (
        !inventory.children.has(parent) &&
        !inventory.indexedChildren.has(parent) &&
        !inventory.listings.has(parent)
      )
        continue
      const stat =
        known === undefined
          ? this.rawStat(path)
          : Promise.resolve(known === null ? null : { type: known })
      for (const cache of [inventory.children, inventory.indexedChildren]) {
        const children = cache.get(parent)
        if (children !== undefined)
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
                        identity: await this.directories.identity(path),
                      },
                    ]
                  : []),
            ])
          )
      }
      const prior = inventory.listings.get(parent)
      if (prior !== undefined)
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
  private readonly ledger: Pick<StateStore, 'all'> | null
  /** Pulls can finish before Obsidian's file index sees their adapter renames. */
  private readonly awaitingIndex = new Set<string>()
  /** Set while `watch` is running: what `kick` reaches for, and nothing when nobody watches. */
  private pollNow: (() => void) | null = null
  private readonly writer: VaultWriter
  private readonly io: BoundedVaultIo
  private readonly stages = new Map<string, JournalEntry>()
  private readonly stageOperations: Set<string>
  private readonly journal: WriteJournal
  private readonly beforeEngineMutation: ((paths: string[]) => Promise<void>) | null
  private readonly runtimeFence: RuntimeFence | null
  private readonly privateRoot?: string
  private readonly scopedAdapter: DataAdapter
  private readonly placementStages: ReturnType<typeof privatePlacementStages>
  get [PRIVATE_PLACEMENT_STAGES]() {
    return this.placementStages
  }
  private readonly guardedAdapter: DataAdapter
  readonly externalCoordination: ExternalFileCoordination

  constructor(
    private readonly app: App,
    options: ObsidianFileSystemOptions = {}
  ) {
    this.placementStages = privatePlacementStages(
      this,
      options.connectionId ? connectionPrivateRoot(options.connectionId) : undefined
    )
    this.scopedAdapter = connectionFilePort(app.vault, options)
    this.privateRoot = options.connectionId
      ? connectionPrivateRoot(options.connectionId)
      : undefined
    this.stageOperations = stageOperations.get(app.vault) ?? new Set<string>()
    stageOperations.set(app.vault, this.stageOperations)
    this.configRevision = adapterConfigRevision(this.scopedAdapter, app.vault.configDir)
    this.cachedConfigRevision = this.configRevision()
    this.preserveEmptyDirectories = options.preserveEmptyDirectories ?? false
    this.fileScope = options.fileScope
    this.startupInventory = options.startupInventory
    this.discovery = options.discovery
    this.runtimeFence = options.runtimeFence ?? null
    this.externalCoordination = externalCoordinationOf(app.vault)
    const runtimeAdapter = this.runtimeFence
      ? fencedPort(
          this.scopedAdapter,
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
      : this.scopedAdapter
    this.diagnostic = options.diagnostic
    const diagnosticNative = new WeakMap<object, object>()
    const guardedMethods = new Map<
      PropertyKey,
      { source: unknown; wrapped: (...args: unknown[]) => unknown }
    >()
    this.guardedAdapter = new Proxy(runtimeAdapter, {
      get: (target, key) => {
        const source = Reflect.get(this.scopedAdapter, key)
        const cached = guardedMethods.get(key)
        if (cached && cached.source === source) return cached.wrapped
        const value = Reflect.get(target, key)
        if (key === 'fsPromises' && value && options.diagnostic) {
          if (!diagnosticNative.has(value))
            diagnosticNative.set(value, nativeDiagnostics(value, options.diagnostic))
          return diagnosticNative.get(value)
        }
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
          const result = bound(...args)
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
      this.discovery?.roots ?? (() => this.scopedRoot())
    )
    this.beforeEngineMutation = options.beforeEngineMutation ?? null
    this.ledger = options.ledger ?? null
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
    this.now = options.now ?? ((): number => Date.now())
    this.onWatch = options.onWatch ?? null
    this.onEngineWrite = options.onEngineWrite ?? null
    this.yieldsToServer = options.yieldsToServer ?? null
    this.journal = new WriteJournal(
      options.storage ?? storageOf(app),
      () => this.runtimeFence?.assertOwned(),
      options.journalOwner ?? options.connectionId,
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
    this.writer = new VaultWriter({
      stagingDirectory: stagingDirectory(this.configDir, this.privateRoot),
      filesystem: this.guardedAdapter,
      native: this.native,
      journal: this.journal,
      fingerprint: (path) => this.io.fingerprint(path, undefined, true),
      adoptReceipt: (from, to) => this.io.adoptReceipt(from, to),
      indexed: (path) => app.vault.getAbstractFileByPath(path) !== null,
      makeParents: (path) => this.makeParents(path),
      installed: (path) => {
        this.awaitingIndex.add(path)
        this.wrote([path], 'file')
      },
    })
  }

  /** Obsidian desktop's `fs.promises`, or null on a phone (`vaultWrites.nativeOf`). */
  private get native(): NativeFs | null {
    const native = nativeOf(
      this.disk,
      (paths = []) => {
        for (const path of paths) this.inventory?.mutations.add(path)
        this.runtimeFence?.assertOwned()
        this.externalCoordination.assertEnginePaths(paths)
      },
      this.privateRoot ? this.privateRoot + '/recovery' : undefined
    )
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
            'archiveBackup',
          ],
          false
        )
      : native
  }

  private get disk(): DataAdapter {
    return this.guardedAdapter
  }

  private async makeParents(path: string): Promise<void> {
    const inventory = this.inventory
    const known = inventory ? (inventory.parentFolders ??= new Set()) : undefined
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
  async *listDirectories() {
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
    const prior = this.inventory?.children.get(parent)
    if (prior !== undefined) return (await prior).map((one) => ({ ...one }))
    const children = this.readInventoryChildren(parent)
    this.inventory?.children.set(parent, children)
    return (await children).map((one) => ({ ...one }))
  }
  private async readInventoryChildren(parent: string): Promise<InventoryChild[]> {
    const scope = this.scopedRoot()
    if (scope && (parent === '' || scope.startsWith(parent + '/'))) {
      const path = scope
        .split('/')
        .slice(0, parent ? parent.split('/').length + 1 : 1)
        .join('/')
      return [{ path, kind: 'directory' }]
    }
    if (scope && !this.withinFileScope(parent))
      throw new EngineError('protocol', 'Inventory path is outside this connection')
    if (this.discovery && this.discovery.roots.length === 0) {
      const children = new Map<string, InventoryChild>()
      for (const file of this.app.vault.getFiles()) {
        if (!this.discovery.includes(file.path) || (parent && !file.path.startsWith(parent + '/')))
          continue
        const prefix = parent ? parent + '/' : ''
        const tail = file.path.slice(prefix.length)
        const cut = tail.indexOf('/')
        const path = cut < 0 ? file.path : prefix + tail.slice(0, cut)
        children.set(path, { path, kind: cut < 0 ? 'file' : 'directory' })
      }
      return [...children.values()]
    }
    const listing = await this.inventoryListing(parent)
    const children: InventoryChild[] = listing.files
      .filter((path) => !isAdapterTemp(path))
      .map((path) => ({ path, kind: 'file' }))
    for (const path of listing.folders) {
      if (await this.isSymlink(path)) continue
      children.push({ path, kind: 'directory', identity: await this.directories.identity(path) })
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
    // Every cached listing above the new folder has to learn about them, including raw
    // listings read before the folder existed.
    this.updateInventory(prefixes.filter((one) => this.withinFileScope(one)))
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
  needsRecoveryHandshake(): boolean {
    return (
      this.journal
        .entries()
        .some((entry) => !entry.retiredGeneration && (!entry.streaming || entry.backup)) ||
      this.journal.vaultRecovered().length > 0
    )
  }
  /** Called only after explicit Follow verified the destination file set. */
  followRecoveredRoot(from: string, to: string): void {
    this.runtimeFence?.assertReady()
    assertPhysicalPath(from)
    assertPhysicalPath(to)
    const privateRoot = this.privateRoot
    if (!privateRoot || from !== this.scopedRoot())
      throw new EngineError('io', 'The recovery placement changed; sync remains stopped')
    // Unfinished installs cannot be relabelled or replayed into a different placement.
    if (this.journal.entries().some((entry) => !withinRoot(entry.target, privateRoot)))
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
      this.journal
        .recovered()
        .some(
          (entry) =>
            (!withinRoot(entry.target, from) &&
              !withinRoot(entry.target, to) &&
              !withinRoot(entry.target, privateRoot)) ||
            backupSuffix(entry.backup) === undefined
        )
    )
      throw new EngineError('io', 'Unproven recovery copy prevents following the folder')
    for (const entry of this.journal.recovered()) {
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
    this.journal.relocateRecoveredTargets(from, to)
  }

  async recover(): Promise<void> {
    this.runtimeFence?.assertOwned()
    if (
      this.scopedRoot() &&
      [...this.journal.entries(), ...this.journal.vaultRecovered()].some(
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
    if (
      !this.journal.entries().length &&
      !(this.native?.archiveBackup && this.journal.vaultRecovered().length)
    )
      return
    await pathCoordinatorOf(this.app.vault).run(
      [''],
      async () => {
        // Recovery can touch journal-owned paths not known until its asynchronous inspection.
        const release = this.externalCoordination.beginEngineMutation([''])
        try {
          this.runtimeFence?.assertOwned()
          await this.writer.recover()
          this.runtimeFence?.assertOwned()
        } finally {
          release()
        }
      },
      () => this.runtimeFence?.assertOwned()
    )
  }

  async discardPrivateDownloads(): Promise<void> {
    if (!this.privateRoot) return
    for (const entry of this.journal.entries())
      if (
        !entry.retiredGeneration &&
        entry.streaming &&
        !entry.backup &&
        entry.temp &&
        withinRoot(entry.target, this.privateRoot + '/placement-inbox') &&
        withinRoot(entry.temp, this.privateRoot)
      ) {
        if ((await this.rawStat(entry.temp)) === null) {
          // Creation and discard each have a durable-intent/missing-file crash window.
          this.journal.drop(entry)
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
  }

  /** A retained streaming source is not a pending destructive installation. */
  async fenceRecovery(state: StateStore, head: number): Promise<void> {
    const entries = this.journal
      .entries()
      .filter((entry) => !entry.retiredGeneration && (!entry.streaming || entry.backup))
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
    for (const entry of this.journal.entries())
      if (
        !entry.retiredGeneration &&
        (!entry.streaming || entry.backup !== undefined) &&
        paths.some((path) => {
          const target = caseKey(entry.target),
            key = caseKey(path)
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

  async *list(): AsyncIterable<FileInfo> {
    const own = this.inventory === null && this.inventoryDepth === 0
    const inventory = own
      ? {
          listings: new Map(),
          mutations: new Set<string>(),
          children: new Map(),
          indexedChildren: new Map(),
        }
      : this.inventory
    if (own) this.inventory = inventory
    try {
      yield* this.listUnlocked()
    } finally {
      if (own && this.inventory === inventory) this.inventory = null
    }
  }
  private async *listUnlocked(): AsyncIterable<FileInfo> {
    const scope = this.scopedRoot()
    this.runtimeFence?.assertReady()
    await this.recover()
    const mutations = folderMutations(this.app.vault)
    await mutations.settled()
    const revision = mutations.revision
    const indexed = new Set<string>()
    const withinScope = (path: string) => this.withinFileScope(path)
    const files =
      this.discovery && this.discovery.roots.length === 0
        ? this.app.vault.getFiles().filter((file) => this.discovery.includes(file.path))
        : this.rawVaultFiles(scope)
    for await (const file of files) {
      if (!withinScope(file.path) || (this.discovery && !this.discovery.includes(file.path)))
        continue
      if (isAdapterTemp(file.path) || isDeviceLocalPluginState(file.path, this.configDir)) continue
      if (this.awaitingIndex.has(file.path)) {
        const actual = await this.rawStat(file.path)
        if (!actual || actual.type !== 'file') continue
        if (actual.size === file.stat.size && stamp(actual.mtime) === stamp(file.stat.mtime))
          this.awaitingIndex.delete(file.path)
        indexed.add(caseKey(file.path))
        yield { path: file.path, size: actual.size, mtime: stamp(actual.mtime) }
        continue
      }
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
      if (!withinScope(path)) continue
      if (this.discovery && !this.discovery.includes(path)) continue
      if (indexed.has(caseKey(path)) || path.startsWith(`${this.configDir}/`)) {
        continue
      }
      // stat alone on a case-folding disk would keep a phantom Report.md after a rename to
      // report.md. List its parent for the actual spelling, and never yield both names.
      const actual = await this.spellingOnDisk(path)
      const info = actual === null || !withinScope(actual) ? null : await this.fileAt(actual)
      if (info !== null && !indexed.has(caseKey(info.path))) {
        indexed.add(caseKey(info.path))
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
    const files = new Set(this.indexedFiles(scope).map((file) => file.path))
    const folders = new Set<string>()
    const within = (path: string) => !scope || path === scope || path.startsWith(scope + '/')
    // A folder token reads only its own subtree and the folders leading down to it.
    const relevant = (path: string) => within(path)
    const visible = (path: string) =>
      !path.split('/').some((part) => part.startsWith('.')) ||
      path === this.configDir ||
      path.startsWith(this.configDir + '/')
    const root =
      scope === undefined ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(scope)
    const index = (node: { path: string; children?: unknown[] }) => {
      if (node.path && !visible(node.path)) return
      if (!node.children) return
      if (node.path) folders.add(node.path)
      for (const child of node.children) index(child as typeof node)
    }
    // The vault root has path '/', not ''. It is a traversal anchor, never a sync item.
    if (scope === undefined) {
      for (const child of (root as { children?: unknown[] } | null)?.children ?? [])
        index(child as { path: string; children?: unknown[] })
    } else if (root) index(root)
    for (const path of files)
      for (let cut = path.indexOf('/'); cut !== -1; cut = path.indexOf('/', cut + 1))
        if (within(path.slice(0, cut))) folders.add(path.slice(0, cut))
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
    for (const path of files) addFile(path)
    const under = (paths: Iterable<string>, self: boolean) => {
      const result = new Map<string, string[]>()
      const put = (key: string, path: string) => {
        const list = result.get(key)
        if (list) list.push(path)
        else result.set(key, [path])
      }
      for (const path of paths) {
        const key = caseKey(path)
        for (let cut = key.indexOf('/'); cut !== -1; cut = key.indexOf('/', cut + 1))
          put(key.slice(0, cut), path)
        if (self) put(key, path)
      }
      return result
    }
    const filesUnder = under(indexedFiles, false)
    const foldersAt = under(indexedFolders, true)
    const parents = new Set<string>()
    for (const path of [...files, ...folders]) {
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
        const key = caseKey(child)
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
    for (const path of (await this.physicalPaths(scope)).files) {
      if (path.split('/').some((part) => part.startsWith('.'))) continue
      const file = indexed.get(path)
      // An indexed row keeps the index's own stat: the caller compares it with the disk to
      // learn whether Obsidian has caught up with a write it is still waiting on.
      const stat = file ? file.stat : await this.rawStat(path)
      if (stat) yield { path, stat }
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
      this.observedBases.set(caseKey(path), { sha: await sha256(bytes) })
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
    this.observedBases.set(caseKey(path), { sha: identity.sha })
    return { ...identity, mtime: stamp(identity.mtime) }
  }
  async fingerprint(path: string, signal?: AbortSignal) {
    const identity = await this.io.fingerprint(path, signal, false, true)
    this.observedBases.set(caseKey(path), { sha: identity.sha })
    return { ...identity, mtime: stamp(identity.mtime) }
  }
  async [Symbol.for('abele.sync.fingerprint-fresh-v1')](path: string) {
    return this.fingerprint(path)
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
    this.observedBases.set(caseKey(path), { sha: identity.sha })
    // Native stats retain fractional milliseconds for source-generation checks.
    // The core identity must use the same wire date as stat/list and staged bases.
    return { ...identity, mtime: stamp(identity.mtime) }
  }
  async beginAtomicWrite(
    path: string,
    mtime: number,
    expectedBase: ContentIdentity | null,
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
        base: expectedBase ? { size: expectedBase.size, sha: expectedBase.sha } : null,
      },
    }
    if (entry.disposableSource) reserveSourceStage(temp)
    let ready = false
    try {
      this.journal.add(entry)
      this.stages.set(temp, entry)
      await this.io.create(temp, mtime)
      const stage = await this.reopenStage(temp)
      ready = true
      return stage
    } finally {
      if (!ready) releaseSourceStage(temp)
    }
  }
  /** Cleanup also works after removal reached disk but journal retirement did not. */
  async discardStage(id: string): Promise<void> {
    this.runtimeFence?.assertReady()
    const entry = this.journal.entries().find((one) => one.temp === id && one.streaming)
    if (this.stageOperations.has(id) || entry?.backup || entry?.retiredGeneration)
      throw new EngineError('io', 'stage is busy or awaiting recovery')
    const standing = await this.rawStat(id)
    if (standing !== null) {
      if (!entry || standing.type !== 'file')
        throw new EngineError('io', 'cannot discard an unowned stage')
      await this.disk.remove(id)
    }
    if (entry) this.journal.drop(entry)
    this.stages.delete(id)
    releaseSourceStage(id)
  }
  async reopenStage(id: string): Promise<AtomicStage & { readonly target: string }> {
    let entry =
      this.journal.entries().find((one) => one.temp === id && one.streaming) ?? this.stages.get(id)
    const stat = await this.rawStat(id)
    if (!stat) throw Object.assign(new Error('streaming stage is missing'), { code: 'ENOENT' })
    if (!entry?.streaming || entry.backup || entry.retiredGeneration)
      throw new EngineError('io', 'streaming stage is unavailable or awaiting recovery')
    if (stat.type !== 'file') throw new EngineError('io', 'streaming stage is not a file')
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
        if (
          this.journal
            .entries()
            .some((one) => one.temp === id && (one.backup || one.retiredGeneration))
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
          this.journal.replace(entry, sealed)
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
            await this.writer.holding(id, () => this.writer.publishStage(entry))
            this.stages.delete(id)
            this.observedBases.delete(caseKey(entry.target))
            finished = true
            releaseSourceStage(id)
          } finally {
            release()
          }
        }),
      discard: () =>
        finished
          ? Promise.resolve()
          : exclusive(async () => {
              if ((await this.rawStat(id)) !== null) await this.disk.remove(id)
              this.journal.drop(entry)
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
    const entry = this.journal.entries().find((one) => one.temp === id)
    if (!entry?.streaming || entry.backup || this.stageOperations.has(id))
      throw new EngineError('io', 'pull stage cannot restart during publication')
    const restarted: JournalEntry = {
      ...entry,
      replacementSha: undefined,
      streaming: { ...entry.streaming, sealed: undefined },
    }
    // Retire the old seal before truncating only this journal-owned private download.
    // No persisted digest authenticates bytes left by a previous process.
    this.journal.replace(entry, restarted)
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
    from: string | null = null
  ) {
    const previous = id ? this.journal.entries().find((one) => one.temp === id) : undefined
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
      this.journal.replace(previous, retained)
      this.stages.set(id, retained)
      return this.reopenPullStage(id)
    }
    if (previous?.backup)
      throw new EngineError('io', 'pull publication is awaiting backup recovery')
    const stage = await this.beginAtomicWrite(target, mtime, null)
    const entry = this.journal.entries().find((one) => one.temp === stage.id)
    if (!entry?.streaming) throw new EngineError('io', 'Recovery download stage lost its journal')
    if ((await this.rawStat(target)) ?? (from ? await this.rawStat(from) : null)) {
      const retained: JournalEntry = {
        ...entry,
        streaming: { ...entry.streaming, retainBase: true },
      }
      this.journal.replace(entry, retained)
      this.stages.set(stage.id, retained)
    }
    if (previous) this.journal.drop(previous)
    console.debug('[abele-sync] redownloading published pull while retaining uncertain local bytes')
    return this.reopenStage(stage.id)
  }

  async writeAtomic(path: string, bytes: Uint8Array, mtime: number): Promise<void> {
    this.writtenStat = null
    const release = this.externalCoordination.beginEngineMutation([path])
    try {
      await this.writeUnreserved(path, bytes, mtime)
      // Record only a successful publication. A later local edit must differ from this
      // baseline on the next scan, rather than being adopted as part of our write.
      this.writtenStat = { path, size: bytes.length, mtime }
    } finally {
      release()
    }
  }

  private async writeUnreserved(path: string, bytes: Uint8Array, mtime: number): Promise<void> {
    this.runtimeFence?.assertReady()
    const key = caseKey(path),
      expected = this.observedBases.get(key)
    // An observed absence authorizes only exclusive creation. The adapter's rename
    // refuses an occupied target, including a file created after the core's last check.
    const standing = expected && 'absent' in expected ? null : await this.onlyFileOrNothing(path)
    if (standing && standing.size > MAX_CHUNK_BYTES)
      throw new EngineError('conflict', 'Existing file requires bounded streaming replacement')
    const before = standing === null ? null : await this.disk.readBinary(path)
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
    await this.writer.write(path, bytes, mtime, standing !== null, before)
    this.observedBases.delete(key)
  }

  async move(from: string, to: string): Promise<void> {
    const release = this.externalCoordination.beginEngineMutation([from, to])
    try {
      await this.moveUnreserved(from, to)
    } finally {
      release()
    }
  }

  private async moveUnreserved(from: string, to: string): Promise<void> {
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
      this.awaitingIndex.add(from)
      this.awaitingIndex.add(to)
      this.wrote([from, to])
      // Only a listing that says outright that the old spelling is still there sends this
      // round again; a listing that would not answer leaves the rename as done.
      if ((await this.spelledExactly(to)) !== false) return
      await this.writer.respell(from, to, (path) => this.spelledExactly(path))
      return
    }
    await makeParents(this.disk, to)
    await this.rename(from, to)
    this.awaitingIndex.add(from)
    this.awaitingIndex.add(to)
    this.wrote([from, to])
    await this.directories.removedChild(from)
    if (!this.preserveEmptyDirectories)
      await pruneAbove(this.disk, this.native, this.configDir, from)
  }

  async remove(path: string): Promise<void> {
    const release = this.externalCoordination.beginEngineMutation([path])
    try {
      await this.removeUnreserved(path)
    } finally {
      release()
    }
  }

  private async removeUnreserved(path: string): Promise<void> {
    this.runtimeFence?.assertReady()
    await this.beforeEngineMutation?.([path])
    const standing = await this.rawStat(path)
    if (standing === null) return
    if (standing.type !== 'file') throw conflictAt(path, standing)
    try {
      await this.disk.remove(path)
    } catch (cause) {
      if (cause instanceof EngineError && cause.code === 'lost') throw cause
      // Two removes of one file race, or the user deleted it while this one was asked for.
      if ((await this.rawStat(path)) === null) return
      throw new EngineError('io', `cannot remove ${path}`, cause)
    }
    if (this.privateRoot && withinRoot(path, this.privateRoot)) return
    this.awaitingIndex.add(path)
    this.wrote([path], null)
    await this.directories.removedChild(path)
    if (!this.preserveEmptyDirectories)
      await pruneAbove(this.disk, this.native, this.configDir, path)
  }

  /** Tell the host what the engine changed on disk (`onEngineWrite`). */
  private wrote(paths: readonly string[], known?: 'file' | null): void {
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
          if (!this.withinFileScope(prefix) || inventory.publishedParents.has(prefix)) continue
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
    if (info === null) this.observedBases.set(caseKey(path), { absent: true })
    return info === null ? null : this.told(info, false)
  }

  /** The file at `path` as the disk has it, before `told`; null for none, or not a file. */
  private async fileAt(path: string): Promise<FileInfo | null> {
    const indexed = this.app.vault.getFileByPath(path)
    if (indexed && !this.awaitingIndex.has(path))
      return { path, size: indexed.stat.size, mtime: stamp(indexed.stat.mtime) }
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
    this.rootChain = undefined
    const rootChanges = [
      this.app.vault.on('create', (file) => this.invalidateRootChain([file.path])),
      this.app.vault.on('delete', (file) => this.invalidateRootChain([file.path])),
    ]
    const directoryRename = this.app.vault.on('rename', (file, previous) => {
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
                paths.filter((path) => path === IGNORE_FILE || this.withinFileScope(path))
              )
          : null,
        pollMs: this.pollMs,
        configDir: this.configDir,
        snapshot: () => this.configSnapshot(),
      },
      (paths) => cb(paths.filter((path) => path === IGNORE_FILE || this.withinFileScope(path)))
    )
    this.pollNow = watcher.kick
    return () => {
      watcher.stop()
      this.app.vault.offref(directoryRename)
      for (const ref of rootChanges) this.app.vault.offref(ref)
      this.rootChain = undefined
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
        if (isDroppableTemp(path) && !this.stages.has(path) && !this.journal.retainsTemp(path))
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
   * path → `size:mtime` for the whole config folder and the vault's ignore file, which is what
   * a poll compares.
   *
   * The ignore file costs one `stat` a tick and is the only way an edit to it is ever reported:
   * it is neither in the file index nor under the config folder.
   */
  private async configSnapshot(): Promise<Map<string, string>> {
    const taken = new Map<string, string>()
    if (this.scopedRoot() || this.discovery) {
      const ignore = await this.stat(IGNORE_FILE)
      if (ignore !== null) taken.set(ignore.path, `${ignore.size}:${ignore.mtime}`)
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
      taken.set(info.path, `${info.size}:${info.mtime}`)
    }
    const ignore = await this.stat(IGNORE_FILE)
    if (ignore !== null) taken.set(ignore.path, `${ignore.size}:${ignore.mtime}`)
    return taken
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
        : (listing.files.find((file) => caseKey(file) === caseKey(path)) ?? null)
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

  private async rename(from: string, to: string): Promise<void> {
    try {
      const base = this.observedBases.get(caseKey(from))
      await this.disk.rename(from, to)
      await this.io.adoptReceipt(from, to)
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
