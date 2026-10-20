import { sha256 } from './hash'
import {
  type FileSystem,
  type AtomicStage,
  type FileInfo,
  type StateStore,
  type StateEntry,
  type EngineClient,
} from '@abele/sync-sdk/core'
import {
  caseKey,
  kindOf,
  ExternalVerifyResponseSchema,
  type ExternalVerifyRequest,
  type ChangeItem,
  type CommitOp,
} from '@abele/sync-sdk/protocol'
import type { ExternalState } from './state'
import {
  ExternalDocumentSchema,
  OwnedArtifactSchema,
  type ConnectionBinding,
  type ExternalDocument,
  type ExternalOperation,
  type ExternalRecord,
} from './records'
import {
  recognizeProjection,
  inspectProjection,
  serializeProjection,
  MAX_PROJECTION_BYTES,
  projectionPath,
  projectionMime,
} from './projection'
import { ExternalRecoveryRequired } from './recovery'
import { stagingDirectory } from '../stagingDirectory'

export interface RepresentationOptions {
  retiredPaths?: ReadonlySet<string>
  state: ExternalState | null
  /** Read-only empty view for a not-yet-activated ledger. This cannot commit or install. */
  emptyView?: { ledgerId: string; binding: ConnectionBinding }
  ledger: StateStore
  fs: FileSystem
  assertOwned(): void
  scriptsFolder(): string
  configDir?: string
  excluded?(path: string, size: number): boolean
  /** Task-3 stat-first projection inspection cache, scoped to this vault. Never authority for
   * owned paths; a changed stat forces fresh inspection. */
  inspection?: {
    entries: readonly { path: string; size: number; mtime: number; marker: boolean }[]
    save(entries: readonly { path: string; size: number; mtime: number; marker: boolean }[]): void
  }
  verify(fileId: string, input: ExternalVerifyRequest): Promise<unknown>
  /** Called only with verified bytes and durable intent, inside the sync's own serialized job.
   * Existing sidecars must not be overwritten; hosts can conservatively retain cleanup work. */
  installProjection(
    path: string,
    bytes: Uint8Array,
    operationId: string
  ): Promise<'written' | 'cleanup-pending'>
}
export type RepresentationDecision =
  | { kind: 'ordinary' }
  | { kind: 'intentional-absence'; fileId: string; dirty: false }
  | {
      kind: 'hold'
      reason: string
      fileId?: string
      dirty: boolean
      base?: ExternalRecord['lastProvenLocalBase']
    }
const key = caseKey
const unexpectedKey = (id: string) => 'external-unexpected-original-v1:' + id
const terminal = new Set([
  'complete',
  'remote-only',
  'hydrated',
  'projection-written',
  'tombstone',
  'detached',
])

/** Common representation policy over portable ports. It never invents local bytes, identities,
 * or a second head table. Scanner/scope/SHA views omit held representations; the actual ledger
 * keeps the accepted server head and the record keeps the earlier proven local base. */
export class ExternalRepresentation {
  private document!: ExternalDocument
  private readonly entries = new Map<string, StateEntry>()
  private inspectionDirty = false
  private readonly inspectionCapacity: number
  private stopped = false
  private readonly unexpected = new Set<string>()
  private readonly inspected = new Map<
    string,
    { path: string; size: number; mtime: number; marker: boolean }
  >()
  private constructor(private readonly options: RepresentationOptions) {
    this.inspectionCapacity = (options.inspection?.entries.length ?? 0) + 10000
    // Keep the complete startup inventory. A smaller rolling cache thrashes when
    // a scan walks more files than its capacity, rereading every file each cycle.
    for (const entry of options.inspection?.entries ?? []) this.inspected.set(entry.path, entry)
  }
  static async open(options: RepresentationOptions): Promise<ExternalRepresentation> {
    const runtime = new ExternalRepresentation(options)
    runtime.document = options.state
      ? await options.state.snapshot()
      : ExternalDocumentSchema.parse({
          ...options.emptyView,
          schema: 1,
          revision: 0,
          files: [],
          operations: [],
        })
    for (const file of runtime.document.files)
      if (
        file.blockingReason === 'unexpected-original' ||
        (await options.ledger.getMeta(unexpectedKey(file.fileId))) !== null
      )
        runtime.unexpected.add(file.fileId)
    for await (const entry of options.ledger.all()) runtime.entries.set(entry.fileId, entry)
    // Upgrade earlier blockers/scoped dirty evidence to the independent provenance bit
    // before subsequent metadata can replace the display reason.
    const metadata = []
    for (const id of runtime.unexpected)
      if ((await options.ledger.getMeta(unexpectedKey(id))) === null)
        metadata.push({ key: unexpectedKey(id), value: 'unresolved' })
    if (metadata.length && options.state) {
      options.assertOwned()
      await options.state.commit({
        expectedRevision: runtime.document.revision,
        ledger: { metadata },
      })
      runtime.document = await options.state.snapshot()
    }
    options.assertOwned()
    return runtime
  }
  /** Explicit activation/operation commits refresh the cached representation before another scan. */
  async activate(state: ExternalState): Promise<void> {
    this.options.state = state
    await this.refresh()
  }
  async refresh(): Promise<void> {
    if (this.options.state) this.document = await this.options.state.snapshot()
    // Ordinary sync can discover identities after open(). Operation commits must refresh
    // their canonical heads as well as the external document, including scoped heads.
    for (const file of this.document.files) {
      const entry = await this.options.ledger.byFileId(file.fileId)
      if (entry) this.entries.set(file.fileId, entry)
      else this.entries.delete(file.fileId)
    }
    this.owned()
    this.flushInspection()
  }
  private flushInspection(): void {
    if (!this.inspectionDirty) return
    this.owned()
    this.options.inspection?.save([...this.inspected.values()])
    this.inspectionDirty = false
  }
  private owned(): void {
    this.options.assertOwned()
    if (this.stopped)
      throw new ExternalRecoveryRequired('external commit outcome requires recovery')
  }
  private file(id: string): ExternalRecord | undefined {
    return this.document.files.find((file) => file.fileId === id)
  }
  private managed(file: ExternalRecord): boolean {
    return (
      file.representation !== 'hydrated' ||
      file.pendingOperationId !== null ||
      file.availability !== 'active' ||
      file.blockingReason !== null
    )
  }
  private original(file: ExternalRecord, path: string): boolean {
    const entry = this.entries.get(file.fileId)
    return [
      entry?.path,
      entry?.wirePath,
      file.lastProvenLocalBase?.path,
      ...this.document.operations
        .filter((op) => op.expected?.fileId === file.fileId)
        .map((op) => op.expected?.path),
    ].some((candidate) => candidate && key(candidate) === key(path))
  }
  private artifact(path: string): boolean {
    return (
      this.options.retiredPaths?.has(key(path)) ||
      this.document.files.some(
        (file) => file.projectionPath && key(file.projectionPath) === key(path)
      ) ||
      this.document.operations.some(
        (op) =>
          op.ownedArtifacts.some((artifact) => key(artifact.path) === key(path)) ||
          (['projection-update', 'projection-move'].includes(op.kind) &&
            [op.sourcePath, op.targetPath].some(
              (candidate) => candidate && key(candidate) === key(path)
            ))
      )
    )
  }
  private async bytes(path: string, info: FileInfo): Promise<Uint8Array | null> {
    // Known large/damaged sidecars remain held without a whole-file allocation. Unknown
    // candidates use a bounded host prefix reader when available. Read-time guards below
    // additionally recognize markers in the actual ordinary upload buffer.
    const fs = this.options.fs as FileSystem & {
      readPrefix?(path: string, maximum: number): Promise<Uint8Array>
    }
    if (info.size > MAX_PROJECTION_BYTES) return null
    if (fs.readPrefix) return fs.readPrefix(path, MAX_PROJECTION_BYTES)
    return fs.read(path)
  }
  async classify(
    path: string,
    observed?: FileInfo | null,
    supplied?: Uint8Array
  ): Promise<RepresentationDecision> {
    this.owned()
    const info = observed === undefined ? await this.options.fs.stat(path) : observed
    this.owned()
    for (const file of this.document.files) {
      if (this.managed(file) && this.original(file, path)) {
        if (
          info !== null &&
          file.representation !== 'hydrated' &&
          !this.unexpected.has(file.fileId)
        ) {
          // Dirty provenance survives unavailable/delete/approval blockers. The observation is
          // durable before scanner/metadata callers can acknowledge it; no second head table.
          try {
            if (!this.options.state) throw new ExternalRecoveryRequired('external state missing')
            await this.options.state.commit({
              expectedRevision: this.document.revision,
              ledger: { metadata: [{ key: unexpectedKey(file.fileId), value: 'unresolved' }] },
            })
            this.document = await this.options.state.snapshot()
            this.owned()
            this.unexpected.add(file.fileId)
          } catch (error) {
            this.stopped = true
            throw error
          }
        }
        return info === null &&
          !this.unexpected.has(file.fileId) &&
          ['remote-only', 'pending-download'].includes(file.representation)
          ? { kind: 'intentional-absence', fileId: file.fileId, dirty: false }
          : {
              kind: 'hold',
              reason:
                file.representation === 'hydrated' ? 'unfinished-operation' : 'unexpected-original',
              fileId: file.fileId,
              dirty: true,
              base: file.lastProvenLocalBase,
            }
      }
    }
    if (this.artifact(path)) return { kind: 'hold', reason: 'owned-artifact', dirty: false }
    // Inspect the actual upload/write buffer even for a new/excluded destination. Managed
    // originals above still establish their independent dirty provenance first.
    if (supplied && recognizeProjection(supplied))
      return { kind: 'hold', reason: 'projection', dirty: false }
    if (info === null) return { kind: 'ordinary' }
    // Scanner exclusions precede byte inspection. Portable adapters have no bounded read:
    // stat before readPrefix, since their implementation may allocate the entire file.
    if (this.options.excluded?.(path, info.size) || info.size > MAX_PROJECTION_BYTES)
      return { kind: 'ordinary' }
    const prior = this.inspected.get(path)
    if (!supplied && prior?.size === info.size && prior.mtime === info.mtime)
      return prior.marker
        ? { kind: 'hold', reason: 'projection', dirty: false }
        : { kind: 'ordinary' }
    const bytes = supplied ?? (await this.bytes(path, info))
    this.owned()
    const marker = !!bytes && recognizeProjection(bytes)
    if (!supplied) {
      this.inspected.delete(path)
      this.inspected.set(path, { path, size: info.size, mtime: info.mtime, marker })
      if (this.inspected.size > this.inspectionCapacity)
        this.inspected.delete(this.inspected.keys().next().value)
      this.inspectionDirty = true
    }
    if (marker) {
      const inspection = inspectProjection(bytes, path, {
        vaultId: this.document.binding.vaultId,
        owned: this.document.files,
      })
      return {
        kind: 'hold',
        reason: inspection.kind === 'hold' ? inspection.reason : 'projection',
        dirty: false,
      }
    }
    return { kind: 'ordinary' }
  }
  private guardStage(stage: AtomicStage, path: string): AtomicStage {
    const fs = this.options.fs
    return new Proxy(stage, {
      get: (stage, key) => {
        if (key === 'commit')
          return async (signal?: AbortSignal) => {
            if ((await this.classify(path)).kind !== 'ordinary')
              throw new ExternalRecoveryRequired(
                'held representation cannot be mutated by ordinary sync'
              )
            const stat = await fs.stat(stage.id)
            if (stat && stat.size <= MAX_PROJECTION_BYTES && fs.openRead) {
              const source = await fs.openRead(stage.id)
              try {
                const bytes = await source.read(0, source.size, signal)
                if ((await this.classify(path, undefined, bytes)).kind !== 'ordinary')
                  throw new ExternalRecoveryRequired('projection bytes cannot be ordinary content')
              } finally {
                await source.close()
              }
            }
            return stage.commit(signal)
          }
        const value = Reflect.get(stage, key)
        return typeof value === 'function' ? value.bind(stage) : value
      },
    })
  }
  fileSystem(): FileSystem {
    const fs = this.options.fs
    // Proxy closures deliberately retain their owner after the method returns.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- The original coordinator must survive later method receivers.
    const self = this
    return new Proxy(fs, {
      get(target, method) {
        if (method === 'list')
          return async function* () {
            try {
              for await (const info of fs.list())
                if ((await self.classify(info.path, info)).kind === 'ordinary') yield info
            } finally {
              // One bounded persistence write per scan, including interrupted enumerations.
              self.flushInspection()
            }
          }
        if (method === 'openRead' || method === 'fingerprint')
          return async (path: string, ...args: unknown[]) => {
            if ((await self.classify(path)).kind !== 'ordinary')
              throw new ExternalRecoveryRequired('held representation is not ordinary content')
            return Reflect.get(target, method).call(target, path, ...args)
          }
        if (method === 'beginAtomicWrite' && fs.beginAtomicWrite)
          return async (...args: Parameters<NonNullable<FileSystem['beginAtomicWrite']>>) => {
            const path = args[0]
            if ((await self.classify(path)).kind !== 'ordinary')
              throw new ExternalRecoveryRequired(
                'held representation cannot be mutated by ordinary sync'
              )
            const stage = await fs.beginAtomicWrite(...args)
            return self.guardStage(stage, path)
          }
        if (method === 'reopenStage' && fs.reopenStage)
          return async (id: string) => {
            const stage = (await fs.reopenStage(id)) as AtomicStage & { target?: string }
            if (typeof stage.target !== 'string')
              throw new ExternalRecoveryRequired('stage target is unavailable')
            return self.guardStage(stage, stage.target)
          }
        if (method === 'read')
          return async (path: string) => {
            const bytes = await fs.read(path)
            if ((await self.classify(path, undefined, bytes)).kind !== 'ordinary')
              throw new ExternalRecoveryRequired('held representation is not ordinary content')
            return bytes
          }
        if (['writeAtomic', 'move', 'remove'].includes(String(method)))
          return async (...args: unknown[]) => {
            const paths = args.slice(0, method === 'move' ? 2 : 1) as string[]
            for (const path of paths)
              if ((await self.classify(path)).kind !== 'ordinary')
                throw new ExternalRecoveryRequired(
                  'held representation cannot be mutated by ordinary sync'
                )
            if (
              method === 'writeAtomic' &&
              (await self.classify(args[0] as string, undefined, args[1] as Uint8Array)).kind !==
                'ordinary'
            )
              throw new ExternalRecoveryRequired('projection bytes cannot be ordinary content')
            return Reflect.get(target, method).apply(target, args)
          }
        const value = Reflect.get(target, method)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  stateStore(store = this.options.ledger): StateStore {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- The stored coordinator survives proxy method calls.
    const self = this
    return new Proxy(store, {
      get(target, method) {
        if (method === 'all')
          return async function* () {
            for await (const entry of store.all()) {
              const file = self.file(entry.fileId)
              if (
                (!file || !self.managed(file)) &&
                (await self.classify(entry.path)).kind === 'ordinary'
              )
                yield entry
            }
          }
        if (method === 'getJournal')
          return async () => {
            const journal = await store.getJournal()
            if (journal) await self.guardOps(journal.ops)
            return journal
          }
        const value = Reflect.get(target, method)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  private async guardOps(
    ops: readonly { file_id?: string; path?: string; to_path?: string }[]
  ): Promise<void> {
    this.owned()
    for (const op of ops) {
      if (op.file_id && this.file(op.file_id) && this.managed(this.file(op.file_id)))
        throw new ExternalRecoveryRequired(
          'managed identity publication requires resolved provenance'
        )
      const source = op.file_id ? await this.options.ledger.byFileId(op.file_id) : null
      for (const path of [op.path, op.to_path, source?.path])
        if (path && (await this.classify(path)).kind !== 'ordinary')
          throw new ExternalRecoveryRequired('projection publication requires recovery')
    }
    this.owned()
  }
  engineClient(client: EngineClient): EngineClient {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- The captured coordinator survives client interception.
    const self = this
    return new Proxy(client, {
      get(target, method) {
        if (method === 'changes')
          return async (...args: Parameters<EngineClient['changes']>) => {
            let since = args[0]
            for (;;) {
              const page = await client.changes(since, args[1]),
                items: ChangeItem[] = []
              for (const item of page.items) if (!(await self.accept(item))) items.push(item)
              self.owned()
              if (items.length || !page.items.length || page.next_since >= page.head_seq)
                return { ...page, items }
              // Core uses an empty page as a terminal signal. Continue past external-only
              // pages, whose work is already durable, before exposing that terminal signal.
              if (page.next_since <= since)
                throw new ExternalRecoveryRequired('external feed did not advance')
              since = page.next_since
            }
          }
        if (method === 'manifest')
          return async (...args: Parameters<EngineClient['manifest']>) => {
            const page = await client.manifest(...args),
              items = []
            for (const item of page.items) {
              if (
                !(await self.accept({
                  ...item,
                  op: 'create',
                  prev_path: null,
                  actor: { kind: 'system', id: 'manifest', name: 'Manifest' },
                  at: '',
                }))
              )
                items.push(item)
            }
            return { ...page, items }
          }
        if (method === 'commit' || method === 'commitRaw') {
          // Capture this method incarnation: host receipt/publication hooks wrap it after
          // composition. Looking it up again inside the closure would call the new hook
          // recursively instead of its captured predecessor.
          const commit = Reflect.get(target, method).bind(target)
          return async (ops: CommitOp[], ...args: unknown[]) => {
            await self.guardOps(ops)
            return commit(ops, ...args)
          }
        }
        const value = Reflect.get(target, method)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  private async commit(
    file: ExternalRecord,
    operation: ExternalOperation,
    ledger?: Parameters<ExternalState['commit']>[0]['ledger']
  ): Promise<void> {
    this.owned()
    const current = this.file(file.fileId),
      prior = this.document.operations.find((op) => op.operationId === operation.operationId)
    try {
      if (!this.options.state)
        throw new ExternalRecoveryRequired('external durable state has not been activated')
      await this.options.state.commit({
        expectedRevision: this.document.revision,
        files: [{ expectedRevision: current.localRevision, next: file }],
        operations: [{ expectedRevision: prior?.revision ?? null, next: operation }],
        ledger,
      })
      this.document = await this.options.state.snapshot()
      for (const entry of ledger?.putEntries ?? []) this.entries.set(entry.fileId, entry)
      this.owned()
    } catch (error) {
      this.stopped = true
      throw error
    }
  }
  private eligibility(path: string, kind: string, size: number): string | null {
    const first = key(path.split('/')[0]),
      scripts = key(this.options.scriptsFolder())
    if (
      kind === 'script' ||
      kind === 'settings' ||
      (this.options.configDir !== undefined && first === key(this.options.configDir)) ||
      key(path) === scripts ||
      key(path).startsWith(scripts + '/') ||
      /\.(js|mjs|cjs|ts|tsx|jsx|py|sh|wasm|exe)$/i.test(path)
    )
      return 'approval-required'
    if (
      kind !== 'attachment' ||
      kindOf(path, this.options.scriptsFolder() || 'Scripts') !== 'attachment'
    )
      return 'ineligible'
    return this.options.excluded?.(path, size) ? 'excluded' : null
  }
  /** Persist required work BEFORE returning a page that core may checkpoint. No client blob
   * read and no filesystem effect precedes the durable job. All token heads use one ledger. */
  async accept(change: ChangeItem): Promise<boolean> {
    this.owned()
    const file = this.file(change.file_id)
    if (!file || !this.managed(file)) return false
    const entry = this.entries.get(file.fileId)
    if (!entry || !file.lastProvenLocalBase)
      throw new ExternalRecoveryRequired('managed file has no proven base/head')
    // Accepting server metadata is not permission to replace another local identity's
    // placement (including tombstones with unresolved sidecars). Keep the event replayable.
    {
      for await (const placed of this.options.ledger.all())
        if (
          placed.fileId !== file.fileId &&
          [placed.path, placed.wirePath].some((path) => key(path) === key(change.path))
        )
          throw new ExternalRecoveryRequired('external rename placement collision')
    }
    const desired = change.op === 'delete' ? 'deleted' : 'active'
    const expected = {
      fileId: file.fileId,
      versionId: change.version_id,
      path: change.path,
      sha: change.sha ?? entry.sha,
      size: change.size ?? entry.size,
    }
    const existing = this.document.operations.find(
      (op) =>
        op.expected?.fileId === file.fileId &&
        op.expected.versionId === expected.versionId &&
        op.expected.path === expected.path &&
        op.desiredAvailability === desired
    )
    if (existing && entry.versionId === expected.versionId && entry.wirePath === expected.path) {
      if (existing.expected?.sha !== expected.sha || existing.expected.size !== expected.size)
        throw new ExternalRecoveryRequired('replayed metadata changed its immutable basis')
      if (
        file.availability !== desired &&
        file.pendingOperationId === existing.operationId &&
        existing.unresolvedOutcome === 'verification-unavailable'
      )
        await this.process(existing.operationId, change.mtime ?? entry.mtime)
      return true
    }
    const operationId = crypto.randomUUID()
    const projection =
      change.op === 'delete'
        ? null
        : serializeProjection({
            format: 'abele.external',
            schema: 1,
            vaultId: this.document.binding.vaultId,
            fileId: file.fileId,
            path: expected.path,
            observedVersionId: expected.versionId,
            sha256: expected.sha,
            size: expected.size,
            mime: projectionMime(expected.path),
            mtime: change.mtime ?? entry.mtime,
          })
    const cut = expected.path.lastIndexOf('/')
    const incomingPath =
      (this.options.configDir
        ? stagingDirectory(this.options.configDir) + '/'
        : cut < 0
          ? ''
          : expected.path.slice(0, cut + 1)) +
      '.abele-external-' +
      operationId +
      '.incoming'
    let incoming = projection
      ? {
          operationId,
          path: incomingPath,
          role: 'projection' as const,
          sha: await sha256(projection),
          size: projection.byteLength,
        }
      : null
    let targetPath = file.projectionPath,
      collision = false
    if (change.op !== 'delete') {
      try {
        targetPath = projectionPath(expected.path)
        if (incoming && !OwnedArtifactSchema.safeParse(incoming).success)
          throw new Error('incoming path collision')
      } catch {
        targetPath = null
        incoming = null
        collision = true
      }
    }
    const operation: ExternalOperation = {
      schema: 1,
      operationId,
      kind:
        change.op === 'delete'
          ? 'tombstone'
          : change.path !== entry.wirePath
            ? 'projection-move'
            : 'projection-update',
      phase: change.op === 'delete' ? 'tombstone' : collision ? 'held' : 'projection-intent',
      revision: 0,
      connectionGeneration: this.document.binding.generation,
      expected,
      sourcePath: file.projectionPath,
      targetPath,
      previousRepresentation: file.representation,
      localBase: file.lastProvenLocalBase,
      desiredRepresentation: file.representation,
      desiredAvailability: desired,
      projectionDigest: incoming?.sha ?? null,
      ownedArtifacts: incoming ? [incoming] : [],
      unresolvedOutcome: null,
      cleanupReason: collision ? 'collision' : null,
    }
    const blocked =
      change.op === 'delete'
        ? 'unavailable'
        : collision
          ? 'collision'
          : this.eligibility(change.path, change.kind, expected.size)
    await this.classify(file.lastProvenLocalBase.path)
    const next = {
      ...file,
      localRevision: file.localRevision + 1,
      pendingOperationId: operation.operationId,
      availability: desired as ExternalRecord['availability'],
      blockingReason: blocked ?? (this.unexpected.has(file.fileId) ? 'unexpected-original' : null),
    }
    // Retain the old proven base unconditionally; discovered originals never acquire v2 by SHA.
    const updated: StateEntry = {
      path: change.path,
      wirePath: change.path,
      fileId: file.fileId,
      versionId: expected.versionId,
      sha: expected.sha,
      size: expected.size,
      mtime: change.mtime ?? entry.mtime,
    }
    await this.commit(next, operation, { putEntries: [updated] })
    this.entries.set(file.fileId, updated)
    if (!blocked) await this.process(operation.operationId, change.mtime ?? entry.mtime)
    return true
  }
  async detach(id: string): Promise<boolean> {
    const file = this.file(id),
      entry = this.entries.get(id)
    if (!file || !this.managed(file)) return false
    if (!entry) throw new ExternalRecoveryRequired('detach head missing')
    if (file.availability === 'detached') {
      return true
    }
    const operation: ExternalOperation = {
      schema: 1,
      operationId: crypto.randomUUID(),
      kind: 'detach',
      phase: 'detached',
      revision: 0,
      connectionGeneration: this.document.binding.generation,
      expected: {
        fileId: id,
        versionId: entry.versionId,
        path: entry.wirePath,
        sha: entry.sha,
        size: entry.size,
      },
      sourcePath: file.projectionPath,
      targetPath: file.projectionPath,
      previousRepresentation: file.representation,
      localBase: file.lastProvenLocalBase,
      desiredRepresentation: file.representation,
      desiredAvailability: 'detached',
      projectionDigest: null,
      ownedArtifacts: [],
      unresolvedOutcome: null,
      cleanupReason: null,
    }
    await this.commit(
      {
        ...file,
        localRevision: file.localRevision + 1,
        availability: 'detached',
        blockingReason: 'unavailable',
        pendingOperationId: operation.operationId,
      },
      operation
    )
    return true
  }
  private async process(operationId: string, mtime?: number): Promise<void> {
    const op = this.document.operations.find((op) => op.operationId === operationId),
      expected = op.expected
    const file = this.file(expected.fileId)
    const entry = this.entries.get(file.fileId)
    let reason = file.blockingReason,
      phase: ExternalOperation['phase'] = op.phase
    const eligibility = this.eligibility(expected.path, 'attachment', expected.size)
    if (eligibility) {
      if (file.blockingReason !== eligibility)
        await this.commit(
          { ...file, localRevision: file.localRevision + 1, blockingReason: eligibility },
          { ...op, revision: op.revision + 1, phase: 'held', cleanupReason: eligibility }
        )
      return
    }
    if (['approval-required', 'ineligible', 'collision'].includes(reason ?? '')) return
    let installationIssued = false
    try {
      this.owned()
      const request = {
        version_id: expected.versionId,
        path: expected.path,
        sha: expected.sha,
        size: expected.size,
      }
      const proof = ExternalVerifyResponseSchema.parse(
        await this.options.verify(file.fileId, request)
      )
      this.owned()
      if (
        proof.file_id !== file.fileId ||
        proof.version_id !== expected.versionId ||
        proof.path !== expected.path ||
        proof.sha !== expected.sha ||
        proof.size !== expected.size
      )
        throw new ExternalRecoveryRequired('server verification basis changed')
      const eligibilityAfterVerification = this.eligibility(
        expected.path,
        'attachment',
        expected.size
      )
      if (eligibilityAfterVerification) {
        await this.commit(
          {
            ...file,
            localRevision: file.localRevision + 1,
            blockingReason: eligibilityAfterVerification,
          },
          {
            ...op,
            revision: op.revision + 1,
            phase: 'held',
            cleanupReason: eligibilityAfterVerification,
          }
        )
        return
      }
      const descriptor = {
        format: 'abele.external',
        schema: 1,
        vaultId: this.document.binding.vaultId,
        fileId: file.fileId,
        path: expected.path,
        observedVersionId: expected.versionId,
        sha256: expected.sha,
        size: expected.size,
        mime: projectionMime(expected.path),
        mtime: mtime ?? entry.mtime,
      }
      let bytes = serializeProjection(descriptor)
      // No replace/remove permission is inferred from equal old projection bytes. Hosts
      // without conditional retirement leave unchanged/changed originals and sidecars intact.
      if (op.projectionDigest !== (await sha256(bytes))) {
        // Previously journalled projections retain their exact immutable byte basis.
        const legacy = serializeProjection({ ...descriptor, mime: 'application/octet-stream' })
        if (op.projectionDigest !== (await sha256(legacy)))
          throw new ExternalRecoveryRequired('recorded projection bytes changed')
        bytes = legacy
      }
      installationIssued = true
      const result = await this.options.installProjection(op.targetPath, bytes, op.operationId)
      this.owned()
      phase = result === 'written' ? 'projection-written' : 'cleanup-pending'
      const original =
        file.lastProvenLocalBase && (await this.classify(file.lastProvenLocalBase.path))
      reason =
        this.unexpected.has(file.fileId) || (original?.kind === 'hold' && original.dirty)
          ? 'unexpected-original'
          : result === 'written'
            ? null
            : 'cleanup-pending'
      const next = {
        ...file,
        localRevision: file.localRevision + 1,
        blockingReason: reason,
        availability: 'active' as const,
        ...(result === 'written'
          ? { projectionPath: op.targetPath, projectionSha: await sha256(bytes) }
          : {}),
      }
      await this.commit(next, {
        ...op,
        revision: op.revision + 1,
        phase,
        projectionDigest: await sha256(bytes),
        cleanupReason: reason,
      })
    } catch (error) {
      // A lost/unknown state commit must never be followed by another phase or filesystem step.
      if (this.stopped) throw error
      this.owned()
      if (
        !installationIssued &&
        ['unauthorized', 'forbidden', 'scope_unavailable', 'not_found'].includes(
          (error as { code?: string }).code ?? ''
        )
      ) {
        await this.detach(file.fileId)
        return
      }
      await this.commit(
        {
          ...file,
          localRevision: file.localRevision + 1,
          blockingReason: 'unavailable',
          availability: installationIssued ? file.availability : 'unavailable',
        },
        {
          ...op,
          revision: op.revision + 1,
          phase: 'held',
          unresolvedOutcome: installationIssued
            ? 'projection-installation-unknown'
            : 'verification-unavailable',
        }
      )
    }
  }
  async recoverJobs(): Promise<void> {
    this.owned()
    for (const operation of [...this.document.operations]) {
      if (
        operation.kind === 'detach' &&
        operation.expected &&
        this.file(operation.expected.fileId)?.availability === 'detached'
      ) {
        continue
      }
      if (
        !['projection-update', 'projection-move'].includes(operation.kind) ||
        terminal.has(operation.phase)
      )
        continue
      const file = operation.expected && this.file(operation.expected.fileId)
      if (!file || file.pendingOperationId !== operation.operationId) continue
      const eligibility = this.eligibility(
        operation.expected.path,
        'attachment',
        operation.expected.size
      )
      if (eligibility) {
        await this.process(operation.operationId)
        continue
      }
      if (
        operation.phase === 'projection-intent' ||
        (operation.unresolvedOutcome && operation.unresolvedOutcome !== 'verification-unavailable')
      ) {
        if (operation.phase !== 'held')
          await this.commit(
            { ...file, localRevision: file.localRevision + 1, blockingReason: 'recovery-required' },
            {
              ...operation,
              revision: operation.revision + 1,
              phase: 'held',
              unresolvedOutcome: 'projection-outcome-needs-inspection',
            }
          )
        continue
      }
      await this.process(operation.operationId)
    }
  }
}
