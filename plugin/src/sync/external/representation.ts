import {
  sha256,
  type FileSystem,
  type FileInfo,
  type StateStore,
  type StateEntry,
  type VaultClient,
  type ScopedClient,
  type ScopedState,
} from '@abele/sync-core'
import {
  caseKey,
  kindOf,
  ExternalVerifyResponseSchema,
  type ExternalVerifyRequest,
  type ChangeItem,
  type CommitOp,
} from '@abele/sync-protocol'
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
} from './projection'
import { ExternalRecoveryRequired } from './recovery'

export interface RepresentationOptions {
  state: ExternalState | null
  /** Read-only empty view for a not-yet-activated ledger. This cannot commit or install. */
  emptyView?: { ledgerId: string; binding: ConnectionBinding }
  ledger: StateStore
  fs: FileSystem
  assertOwned(): void
  scriptsFolder(): string
  configDir?: string
  excluded?(path: string, size: number): boolean
  verify(fileId: string, input: ExternalVerifyRequest): Promise<unknown>
  /** Called only with verified bytes and durable intent, inside the sync's own serialized job.
   * Existing sidecars must not be overwritten; hosts can conservatively retain cleanup work. */
  installProjection(
    path: string,
    bytes: Uint8Array,
    operationId: string
  ): Promise<'written' | 'cleanup-pending'>
  scoped?: ScopedState
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
  private stopped = false
  private readonly unexpected = new Set<string>()
  private constructor(private readonly options: RepresentationOptions) {}
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
      if (file.blockingReason === 'unexpected-original') runtime.unexpected.add(file.fileId)
    for await (const entry of options.ledger.all()) runtime.entries.set(entry.fileId, entry)
    if (options.scoped)
      for (const file of runtime.document.files) {
        const known = await options.scoped.getKnown(file.fileId)
        if (known?.dirty) runtime.unexpected.add(file.fileId)
        if (known)
          runtime.entries.set(file.fileId, {
            path: known.path,
            wirePath: known.path,
            fileId: known.file_id,
            versionId: known.version_id,
            sha: known.sha,
            size: known.size,
            mtime: known.mtime,
          })
      }
    options.assertOwned()
    return runtime
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
    if (fs.readPrefix) return fs.readPrefix(path, MAX_PROJECTION_BYTES)
    if (info.size > MAX_PROJECTION_BYTES) return null
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
        if (info !== null && file.representation !== 'hydrated') this.unexpected.add(file.fileId)
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
    if (info === null) return { kind: 'ordinary' }
    const bytes = supplied ?? (await this.bytes(path, info))
    this.owned()
    if (bytes && recognizeProjection(bytes)) {
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
  fileSystem(): FileSystem {
    const fs = this.options.fs
    // Proxy closures deliberately retain their owner after the method returns.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- The original coordinator must survive later method receivers.
    const self = this
    return new Proxy(fs, {
      get(target, method) {
        if (method === 'list')
          return async function* () {
            for await (const info of fs.list())
              if ((await self.classify(info.path, info)).kind === 'ordinary') yield info
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
      if (op.file_id && this.file(op.file_id) && this.managed(this.file(op.file_id)!))
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
  personalClient(client: VaultClient): VaultClient {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- The captured coordinator survives client interception.
    const self = this
    return new Proxy(client, {
      get(target, method) {
        if (method === 'changes')
          return async (...args: Parameters<VaultClient['changes']>) => {
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
          return async (...args: Parameters<VaultClient['manifest']>) => {
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
    const current = this.file(file.fileId)!,
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
   * read and no filesystem effect precedes the durable job. Personal heads stay in entries;
   * scoped heads stay in ScopedState. */
  async accept(change: ChangeItem): Promise<boolean> {
    this.owned()
    const file = this.file(change.file_id)
    if (!file || !this.managed(file)) return false
    const entry = this.entries.get(file.fileId)
    if (!entry || !file.lastProvenLocalBase)
      throw new ExternalRecoveryRequired('managed file has no proven base/head')
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
    if (existing && file.availability === desired) {
      if (existing.expected?.sha !== expected.sha || existing.expected.size !== expected.size)
        throw new ExternalRecoveryRequired('replayed metadata changed its immutable basis')
      // The durable intent may have committed before a definite/unknown scoped metadata
      // failure. Repair canonical heads before allowing the replayed page to checkpoint.
      await this.scopedHead(
        file,
        {
          path: expected.path,
          wirePath: expected.path,
          fileId: file.fileId,
          versionId: expected.versionId,
          sha: expected.sha,
          size: expected.size,
          mtime: change.mtime ?? entry.mtime,
        },
        desired
      )
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
            mime: 'application/octet-stream',
            mtime: change.mtime ?? entry.mtime,
          })
    const cut = expected.path.lastIndexOf('/')
    const incomingPath =
      (cut < 0 ? '' : expected.path.slice(0, cut + 1)) +
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
    await this.commit(next, operation, this.options.scoped ? undefined : { putEntries: [updated] })
    await this.scopedHead(file, updated, desired)
    if (!blocked) await this.process(operation.operationId, change.mtime ?? entry.mtime)
    return true
  }
  private async scopedHead(
    file: ExternalRecord,
    updated: StateEntry,
    desired: 'active' | 'deleted'
  ): Promise<void> {
    const state = this.options.scoped
    if (!state) return
    const prior = await state.getKnown(file.fileId)
    const observed =
      file.lastProvenLocalBase && (await this.classify(file.lastProvenLocalBase.path))
    await state.putKnown({
      ...prior,
      file_id: file.fileId,
      version_id: updated.versionId,
      path: updated.wirePath,
      sha: updated.sha,
      size: updated.size,
      mtime: updated.mtime,
      state: desired === 'deleted' ? 'deleted' : 'known_not_materialized',
      dirty: (prior?.dirty ?? false) || (observed?.kind === 'hold' && observed.dirty) || false,
    })
    this.owned()
    this.entries.set(file.fileId, updated)
  }
  async detach(id: string): Promise<boolean> {
    const file = this.file(id),
      entry = this.entries.get(id)
    if (!file || !this.managed(file)) return false
    if (!entry) throw new ExternalRecoveryRequired('detach head missing')
    if (file.availability === 'detached') return true
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
    if (this.options.scoped) {
      const known = await this.options.scoped.getKnown(id)
      if (known) await this.options.scoped.putKnown({ ...known, state: 'detached' })
    }
    return true
  }
  private async process(operationId: string, mtime?: number): Promise<void> {
    const op = this.document.operations.find((op) => op.operationId === operationId)!,
      expected = op.expected!
    const file = this.file(expected.fileId)!
    const entry = this.entries.get(file.fileId)!
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
      const bytes = serializeProjection({
        format: 'abele.external',
        schema: 1,
        vaultId: this.document.binding.vaultId,
        fileId: file.fileId,
        path: expected.path,
        observedVersionId: expected.versionId,
        sha256: expected.sha,
        size: expected.size,
        mime: 'application/octet-stream',
        mtime: mtime ?? entry.mtime,
      })
      // No replace/remove permission is inferred from equal old projection bytes. Hosts
      // without conditional retirement leave unchanged/changed originals and sidecars intact.
      if (op.projectionDigest !== (await sha256(bytes)))
        throw new ExternalRecoveryRequired('recorded projection bytes changed')
      installationIssued = true
      const result = await this.options.installProjection(op.targetPath!, bytes, op.operationId)
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
        this.options.scoped &&
        ['unauthorized', 'forbidden', 'scoped_unavailable', 'not_found'].includes(
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
        !['projection-update', 'projection-move'].includes(operation.kind) ||
        terminal.has(operation.phase)
      )
        continue
      const file = operation.expected && this.file(operation.expected.fileId)
      if (!file || file.pendingOperationId !== operation.operationId) continue
      const eligibility = this.eligibility(
        operation.expected!.path,
        'attachment',
        operation.expected!.size
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
  scopedState(state: ScopedState): ScopedState {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- The captured coordinator owns scoped filtering.
    const self = this
    return new Proxy(state, {
      get(target, method) {
        if (method === 'placementStore') return () => self.stateStore(state.placementStore())
        if (method === 'knownPage')
          return async (offset: number, limit = 1000) => {
            const all = []
            for (let from = 0; ; from += 1000) {
              const page = await state.knownPage(from)
              all.push(
                ...page.filter(
                  (known) => !self.file(known.file_id) || !self.managed(self.file(known.file_id)!)
                )
              )
              if (page.length < 1000) break
            }
            return all.slice(offset, offset + limit)
          }
        if (method === 'getJournal')
          return async () => {
            const journal = await state.getJournal()
            if (journal) await self.guardOps(journal.ops)
            return journal
          }
        const value = Reflect.get(target, method)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  scopedClient(client: ScopedClient): ScopedClient {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- The captured coordinator owns scoped receipts.
    const self = this
    const change = (item: {
      file_id: string
      version_id: string
      path: string
      sha: string
      size: number
      mtime: number
      kind: 'attachment' | 'note' | 'canvas'
    }): ChangeItem => ({
      ...item,
      seq: 0,
      op: 'modify',
      prev_path: null,
      actor: { kind: 'system', id: 'scoped', name: 'Scoped sync' },
      at: '',
    })
    let snapshot: {
      id: string
      anchor: string
      seen: Set<string>
      managed: Set<string>
      next: string | null
    } | null = null
    return new Proxy(client, {
      get(target, method) {
        if (method === 'state' || method === 'negotiate')
          return async (...args: unknown[]) => {
            try {
              return await Reflect.get(target, method).apply(target, args)
            } catch (error) {
              if (
                ['unauthorized', 'forbidden', 'scoped_unavailable', 'not_found'].includes(
                  (error as { code?: string }).code ?? ''
                )
              )
                for (const file of [...self.document.files])
                  if (self.managed(file)) await self.detach(file.fileId)
              throw error
            }
          }
        if (method === 'openSnapshot' || method === 'snapshotPage')
          return async (...args: unknown[]) => {
            const page = await Reflect.get(target, method).apply(target, args),
              items = []
            if (method === 'openSnapshot')
              snapshot = {
                id: page.snapshot_id,
                anchor: JSON.stringify(page.checkpoint),
                seen: new Set(),
                managed: new Set(),
                next: page.cursor,
              }
            if (
              !snapshot ||
              snapshot.id !== page.snapshot_id ||
              snapshot.anchor !== JSON.stringify(page.checkpoint) ||
              snapshot.next !== page.cursor
            )
              throw new ExternalRecoveryRequired('scoped snapshot identity or anchor changed')
            for (const item of page.items) {
              if (snapshot.seen.has(item.file_id) || snapshot.seen.size >= 100000)
                throw new ExternalRecoveryRequired('scoped snapshot duplicate or budget exceeded')
              snapshot.seen.add(item.file_id)
              if (self.file(item.file_id) && self.managed(self.file(item.file_id)!))
                snapshot.managed.add(item.file_id)
              else items.push(item)
            }
            snapshot.next = page.next_cursor
            // As in core scoped pull, no metadata/filesystem mutation before complete anchored
            // inventory and its terminal-only feed proof. Resolve managed IDs to current
            // authorized heads; opaque versions do not order snapshot headers against pushes.
            if (page.next_cursor === null && page.feed_checkpoint) {
              for (const id of snapshot.managed) {
                try {
                  const head = await client.head(id)
                  if (head.file_id !== id)
                    throw new ExternalRecoveryRequired('scoped snapshot head identity changed')
                  await self.accept(change(head))
                } catch (error) {
                  if ((error as { code?: string }).code === 'not_found') await self.detach(id)
                  else {
                    if (
                      ['unauthorized', 'forbidden', 'scoped_unavailable'].includes(
                        (error as { code?: string }).code ?? ''
                      )
                    )
                      await self.detach(id)
                    throw error
                  }
                }
              }
              for (const file of [...self.document.files])
                if (
                  self.managed(file) &&
                  !snapshot.seen.has(file.fileId) &&
                  !['detached', 'deleted'].includes(file.availability)
                )
                  await self.detach(file.fileId)
              snapshot = null
            }
            return { ...page, items }
          }
        if (method === 'feed')
          return async (...args: Parameters<ScopedClient['feed']>) => {
            const page = await client.feed(...args),
              events = []
            for (const event of page.events) {
              const id = event.type === 'content' ? event.file.file_id : event.file_id
              if (!self.file(id) || !self.managed(self.file(id)!)) {
                events.push(event)
                continue
              }
              if (event.type === 'content') {
                try {
                  const head = await client.head(id)
                  if (head.file_id !== id)
                    throw new ExternalRecoveryRequired('scoped head identity changed')
                  await self.accept(change(head))
                } catch (error) {
                  if ((error as { code?: string }).code === 'not_found') await self.detach(id)
                  else {
                    if (
                      ['unauthorized', 'forbidden', 'scoped_unavailable'].includes(
                        (error as { code?: string }).code ?? ''
                      )
                    )
                      await self.detach(id)
                    throw error
                  }
                }
              } else if (event.type === 'departed') await self.detach(id)
              else {
                const entry = self.entries.get(id)!
                await self.accept({
                  ...change({
                    file_id: id,
                    version_id: entry.versionId,
                    path: entry.wirePath,
                    sha: entry.sha,
                    size: entry.size,
                    mtime: entry.mtime,
                    kind: 'attachment',
                  }),
                  op: 'delete',
                  sha: null,
                  size: null,
                  mtime: null,
                })
              }
            }
            return { ...page, events }
          }
        if (method === 'commit') {
          const commit = client.commit.bind(client)
          return async (...args: Parameters<ScopedClient['commit']>) => {
            await self.guardOps(args[0].ops)
            return commit(...args)
          }
        }
        const value = Reflect.get(target, method)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
}
