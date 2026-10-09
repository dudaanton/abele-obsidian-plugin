import { sha256, type StateStore } from '@abele/sync-core'
import { ExternalVerifyResponseSchema, kindOf } from '@abele/sync-protocol'
import { ExternalFileHost } from './ObsidianExternalFileHost'
import { ExternalFilePortError } from './filesystem'
import { ExternalState } from './state'
import { projectionPath, serializeProjection } from './projection'
import type {
  ConnectionBinding,
  ExternalDocument,
  ExternalOperation,
  ExternalRecord,
} from './records'
import type { ExternalSerialization } from './coordination'

export type AttachmentReason =
  | 'offline'
  | 'unsupported-server'
  | 'version-changed'
  | 'local-changed'
  | 'collision'
  | 'busy'
  | 'pinned'
  | 'warning-required'
  | 'approval-required'
  | 'ineligible'
  | 'unavailable'
  | 'recovery-required'
  | 'unsupported-storage'
export type OperationResult = {
  status: 'complete' | 'cleanup-pending' | AttachmentReason
  reclaimedBytes: number
}
export type EvictOptions = {
  operationId: string
  expectedRevision: number
  expectedVersionId: string
  acknowledgeScopedWarning?: boolean
  signal?: AbortSignal
}
export type HydrateOptions = {
  operationId: string
  expectedVersionId: string
  signal?: AbortSignal
}
export type AttachmentSnapshot = ExternalRecord & {
  knownVersion: string | null
  operation: ExternalOperation | null
}

export type AttachmentPublication = {
  file_id: string
  version_id: string
  path: string
  sha: string | null
  size: number
}
const requestKey = (id: string) => 'external-eviction-request-v1:' + id

/** Explicit, non-UI operations. The journal, not an adapter receipt, is the authority after
 * restart; no uncertain install/delete is ever issued a second time on retry. */
export class AttachmentStore {
  private stopped = false
  private readonly listeners = new Set<(snapshot: AttachmentSnapshot) => void>()
  constructor(
    private readonly options: {
      state: ExternalState
      ledger: StateStore
      host: ExternalFileHost
      binding: ConnectionBinding
      serial: ExternalSerialization
      assertOwned(): void
      sync(): Promise<unknown>
      verify(
        fileId: string,
        input: { version_id: string; path: string; sha: string; size: number }
      ): Promise<unknown>
      download(fileId: string, versionId: string, sha: string): Promise<Uint8Array>
      scriptsFolder(): string
      excluded?(path: string, size: number): boolean
      scopedHead?(id: string): Promise<{
        file_id: string
        version_id: string
        path: string
        sha: string
        size: number
        mtime: number
      } | null>
      refreshed?(): Promise<void>
      consent?: { read(): Promise<string | null>; write(value: string): Promise<void> }
    }
  ) {}
  private owned(): void {
    this.options.assertOwned()
    if (this.stopped) throw new ExternalFilePortError('recovery-required')
  }
  private async document(): Promise<ExternalDocument> {
    this.owned()
    return this.options.state.snapshot()
  }
  private async head(id: string) {
    if (this.options.binding.mode === 'scoped') {
      if (!this.options.scopedHead) throw new ExternalFilePortError('recovery-required')
      const known = await this.options.scopedHead(id)
      return (
        known && {
          fileId: known.file_id,
          versionId: known.version_id,
          path: known.path,
          wirePath: known.path,
          sha: known.sha,
          size: known.size,
          mtime: known.mtime,
        }
      )
    }
    return this.options.ledger.byFileId(id)
  }
  private async snapshot(id: string): Promise<AttachmentSnapshot | null> {
    const doc = await this.document(),
      file = doc.files.find((f) => f.fileId === id)
    if (!file) return null
    return {
      ...file,
      knownVersion: (await this.head(id))?.versionId ?? null,
      operation: doc.operations.find((op) => op.operationId === file.pendingOperationId) ?? null,
    }
  }
  get(id: string): Promise<AttachmentSnapshot | null> {
    return this.snapshot(id)
  }
  async *list(_query: { fileId?: string } = {}): AsyncIterable<AttachmentSnapshot> {
    const doc = await this.document()
    for (const file of doc.files)
      if (!_query.fileId || file.fileId === _query.fileId) {
        const item = await this.snapshot(file.fileId)
        if (item) yield item
      }
  }
  onChange(listener: (snapshot: AttachmentSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private async changed(id: string): Promise<void> {
    await this.options.refreshed?.()
    const item = await this.snapshot(id)
    if (item) for (const listener of this.listeners) listener(item)
  }
  private async commit(
    file: ExternalRecord,
    op?: ExternalOperation,
    request?: string
  ): Promise<void> {
    this.owned()
    const doc = await this.document()
    const prior = doc.files.find((entry) => entry.fileId === file.fileId)
    const previous = op && doc.operations.find((entry) => entry.operationId === op.operationId)
    try {
      await this.options.state.commit({
        expectedRevision: doc.revision,
        files: [{ expectedRevision: prior?.localRevision ?? null, next: file }],
        ...(op ? { operations: [{ expectedRevision: previous?.revision ?? null, next: op }] } : {}),
        ...(request && op
          ? { ledger: { metadata: [{ key: requestKey(op.operationId), value: request }] } }
          : {}),
      })
    } catch (error) {
      this.stopped = true
      throw error
    }
    await this.changed(file.fileId)
  }
  private result(status: OperationResult['status'], reclaimedBytes = 0): OperationResult {
    return { status, reclaimedBytes }
  }
  private reclaimed(file: ExternalRecord | undefined, head: { sha: string; size: number }): number {
    // A retained name may be a native hard link to the removed original. Until its
    // ownership/outcome is resolved, deleting the visible name has not reclaimed content.
    return file?.retained.some(
      (artifact) => artifact.sha === head.sha && artifact.size === head.size
    )
      ? 0
      : head.size
  }
  private reason(error: unknown): OperationResult {
    if (error instanceof ExternalFilePortError) return this.result(error.reason)
    const code = (error as { code?: string }).code
    if (code === 'unsupported_server') return this.result('unsupported-server')
    if (['forbidden', 'unauthorized', 'not_found'].includes(code ?? ''))
      return this.result('unavailable')
    return this.result('offline')
  }
  private eligible(path: string, size: number): AttachmentReason | null {
    const scripts = this.options.scriptsFolder() || 'Scripts'
    if (kindOf(path, scripts) !== 'attachment') return 'ineligible'
    if (
      /\.(js|mjs|cjs|ts|tsx|jsx|py|sh|wasm|exe)$/i.test(path) ||
      path === scripts ||
      path.startsWith(scripts + '/')
    )
      return 'approval-required'
    return this.options.excluded?.(path, size) ? 'ineligible' : null
  }
  private async verified(
    fileId: string,
    head: { versionId: string; path: string; sha: string; size: number }
  ): Promise<boolean> {
    const proof = ExternalVerifyResponseSchema.parse(
      await this.options.verify(fileId, {
        version_id: head.versionId,
        path: head.path,
        sha: head.sha,
        size: head.size,
      })
    )
    return (
      proof.file_id === fileId &&
      proof.version_id === head.versionId &&
      proof.path === head.path &&
      proof.sha === head.sha &&
      proof.size === head.size
    )
  }
  async inspectEviction(id: string): Promise<{
    status: OperationResult['status']
    revision: number | null
    versionId: string | null
  }> {
    const file = await this.snapshot(id),
      head = await this.head(id)
    if (!head || (!file && !head)) return { status: 'ineligible', revision: null, versionId: null }
    const reason = this.eligible(head.path, head.size)
    return {
      status: reason ?? (file?.pinned ? 'pinned' : 'complete'),
      revision: file?.localRevision ?? 0,
      versionId: head.versionId,
    }
  }
  private consentKey(): string {
    return JSON.stringify([
      this.options.binding.endpoint,
      this.options.binding.vaultId,
      this.options.binding.principalId,
      this.options.binding.grantId,
      this.options.binding.generation,
      1,
    ])
  }
  async evict(id: string, opts: EvictOptions): Promise<OperationResult> {
    if (!opts.operationId || !opts.expectedVersionId || !Number.isInteger(opts.expectedRevision))
      return this.result('ineligible')
    // Ordinary publication must finish OUTSIDE the exclusive queue. A sync that fails
    // cannot authorize a later filesystem effect; revalidate all metadata after the run.
    const request = JSON.stringify([id, opts.expectedVersionId, opts.expectedRevision])
    const retry = (await this.document()).operations.some(
      (op) => op.operationId === opts.operationId
    )
    let published: AttachmentPublication[] = []
    let selected: { path: string; sha: string; size: number } | null = null
    if (!retry) {
      const checked = await this.options.serial.run(async () => {
        const head = await this.head(id),
          file = await this.snapshot(id)
        if (
          !head ||
          head.versionId !== opts.expectedVersionId ||
          (file?.localRevision ?? 0) !== opts.expectedRevision
        )
          return false
        const bytes = await this.options.host.read(head.path)
        selected = { path: head.wirePath, sha: await sha256(bytes), size: bytes.length }
        return true
      })
      if (!checked) return this.result('version-changed')
      try {
        const report = (await this.options.sync()) as
          | { published?: AttachmentPublication[] }
          | undefined
        published = report?.published ?? []
      } catch {
        return this.result('offline')
      }
    } else if ((await this.options.ledger.getMeta(requestKey(opts.operationId))) !== request) {
      return this.result('recovery-required')
    }
    const before = await this.head(id)
    if (!before) return this.result('ineligible')
    let target: string
    try {
      target = projectionPath(before.path)
    } catch {
      return this.result('collision')
    }
    const staging = `${before.path.slice(0, before.path.lastIndexOf('/') + 1)}.abele-external-${opts.operationId}.incoming`
    let phase: 'none' | 'prepared' | 'delete-ready' = 'none'
    return this.options.host.run(
      this.options.serial,
      {
        operationId: opts.operationId,
        fileId: id,
        paths: [before.path, target, staging],
        assertIntent: (effect) => {
          this.owned()
          if ((effect === 'stage' || effect === 'install') && phase === 'prepared') return
          if (effect === 'delete-original' && phase === 'delete-ready') return
          throw new ExternalFilePortError('recovery-required')
        },
      },
      async (effects) => {
        const doc = await this.document(),
          existing = doc.operations.find((op) => op.operationId === opts.operationId)
        const head = await this.head(id)
        if (!head) return this.result('ineligible')
        if (existing) {
          if (
            existing.kind !== 'eviction' ||
            existing.expected?.fileId !== id ||
            existing.expected.versionId !== head.versionId ||
            existing.expected.path !== head.wirePath ||
            existing.expected.sha !== head.sha ||
            existing.expected.size !== head.size
          )
            return this.result('recovery-required')
          return existing.phase === 'remote-only'
            ? this.result(
                'complete',
                this.reclaimed(
                  doc.files.find((file) => file.fileId === id),
                  head
                )
              )
            : this.result('recovery-required')
        }
        const file = doc.files.find((item) => item.fileId === id)
        if (
          (file?.localRevision ?? 0) !== opts.expectedRevision ||
          (head.versionId !== opts.expectedVersionId &&
            !published.some(
              (receipt) =>
                receipt.file_id === id &&
                receipt.version_id === head.versionId &&
                receipt.path === head.wirePath &&
                receipt.sha === head.sha &&
                receipt.size === head.size &&
                selected?.path === head.wirePath &&
                selected.sha === head.sha &&
                selected.size === head.size
            ))
        )
          return this.result('version-changed')
        if (file?.pinned) return this.result('pinned')
        if (
          file &&
          (file.pendingOperationId || file.representation !== 'hydrated' || file.blockingReason)
        )
          return this.result('recovery-required')
        const eligibility = this.eligible(head.path, head.size)
        if (eligibility) return this.result(eligibility)
        if (
          this.options.binding.mode === 'scoped' &&
          (await this.options.consent?.read()) !== this.consentKey()
        ) {
          if (!opts.acknowledgeScopedWarning) return this.result('warning-required')
          if (!this.options.consent) return this.result('unsupported-storage')
          await this.options.consent.write(this.consentKey())
          if ((await this.options.consent.read()) !== this.consentKey())
            return this.result('recovery-required')
        }
        if (opts.signal?.aborted) return this.result('busy')
        const local = await this.options.host.read(head.path)
        if (local.length !== head.size || (await sha256(local)) !== head.sha)
          return this.result('local-changed')
        try {
          if (!(await this.verified(id, { ...head, path: head.wirePath })))
            return this.result('version-changed')
        } catch (error) {
          return this.reason(error)
        }
        if (opts.signal?.aborted) return this.result('busy')
        const sidecar = projectionPath(head.path)
        if (await this.options.host.exists(sidecar)) return this.result('collision')
        const bytes = serializeProjection({
          format: 'abele.external',
          schema: 1,
          vaultId: this.options.binding.vaultId,
          fileId: id,
          path: head.wirePath,
          observedVersionId: head.versionId,
          sha256: head.sha,
          size: head.size,
          mime: 'application/octet-stream',
          mtime: head.mtime,
        })
        const digest = await sha256(bytes),
          stagedPath = `${head.path.slice(0, head.path.lastIndexOf('/') + 1)}.abele-external-${opts.operationId}.incoming`
        const artifact = {
          operationId: opts.operationId,
          path: stagedPath,
          sha: digest,
          size: bytes.length,
          role: 'projection' as const,
        }
        const record: ExternalRecord = file
          ? { ...file, localRevision: file.localRevision + 1, pendingOperationId: opts.operationId }
          : {
              schema: 1,
              ledgerId: doc.ledgerId,
              binding: doc.binding,
              fileId: id,
              representation: 'hydrated',
              preference: 'on-demand',
              pinned: false,
              projectionPath: null,
              projectionSha: null,
              localRevision: 0,
              pendingOperationId: opts.operationId,
              availability: 'active',
              blockingReason: null,
              lastProvenLocalBase: {
                fileId: id,
                versionId: head.versionId,
                path: head.wirePath,
                sha: head.sha,
                size: head.size,
                mtime: head.mtime,
              },
              retained: [],
            }
        const op: ExternalOperation = {
          schema: 1,
          operationId: opts.operationId,
          kind: 'eviction',
          phase: 'prepared',
          revision: 0,
          connectionGeneration: doc.binding.generation,
          expected: {
            fileId: id,
            versionId: head.versionId,
            path: head.wirePath,
            sha: head.sha,
            size: head.size,
          },
          sourcePath: head.path,
          targetPath: sidecar,
          previousRepresentation: 'hydrated',
          localBase: record.lastProvenLocalBase,
          desiredRepresentation: 'remote-only',
          desiredAvailability: 'active',
          projectionDigest: digest,
          ownedArtifacts: [artifact],
          unresolvedOutcome: null,
          cleanupReason: null,
        }
        await this.commit(record, op, request)
        phase = 'prepared'
        if (opts.signal?.aborted) return this.result('recovery-required')
        const staged = await effects.stage(artifact, bytes)
        if (staged.status !== 'staged') return this.result('recovery-required')
        const installed = await effects.install(artifact, sidecar)
        if (installed.status !== 'installed') return this.result('recovery-required')
        const ready: ExternalOperation = { ...op, revision: 1, phase: 'delete-ready' }
        const next = {
          ...record,
          localRevision: record.localRevision + 1,
          projectionPath: sidecar,
          projectionSha: digest,
        }
        await this.commit(next, ready)
        phase = 'delete-ready'
        if (opts.signal?.aborted) return this.result('recovery-required')
        // Restart cannot inherit permission to delete; a fresh operation must verify again.
        const removed = await effects.deleteOriginal({
          path: head.path,
          sha: head.sha,
          size: head.size,
        })
        if (removed.status !== 'deleted') return this.result('recovery-required')
        await this.commit(
          {
            ...next,
            localRevision: next.localRevision + 1,
            representation: 'remote-only',
            pendingOperationId: null,
          },
          { ...ready, revision: 2, phase: 'remote-only' }
        )
        return this.result('complete', this.reclaimed(record, head))
      }
    )
  }
  async hydrate(id: string, opts: HydrateOptions): Promise<OperationResult> {
    if (!opts.operationId || !opts.expectedVersionId) return this.result('ineligible')
    const head = await this.head(id)
    if (!head || head.versionId !== opts.expectedVersionId) return this.result('version-changed')
    const staging = `${head.path.slice(0, head.path.lastIndexOf('/') + 1)}.abele-external-${opts.operationId}.incoming`
    const quarantine = staging.replace(/\.incoming$/, '.projection')
    let phase: 'none' | 'download-intent' | 'ready-to-install' | 'cleanup-pending' = 'none'
    return this.options.host.run(
      this.options.serial,
      {
        operationId: opts.operationId,
        fileId: id,
        paths: [head.path, staging, projectionPath(head.path), quarantine],
        assertIntent: (effect) => {
          this.owned()
          if (effect === 'stage' && phase === 'download-intent') return
          if (effect === 'install' && phase === 'ready-to-install') return
          if (effect === 'retire-projection' && phase === 'cleanup-pending') return
          throw new ExternalFilePortError('recovery-required')
        },
      },
      async (effects) => {
        const doc = await this.document(),
          file = doc.files.find((item) => item.fileId === id)
        const prior = doc.operations.find((op) => op.operationId === opts.operationId)
        if (prior) {
          if (
            prior.kind !== 'hydration' ||
            prior.expected?.fileId !== id ||
            prior.expected.versionId !== opts.expectedVersionId
          )
            return this.result('recovery-required')
          return prior.phase === 'hydrated'
            ? this.result('complete')
            : this.result('recovery-required')
        }
        if (
          !file ||
          file.representation !== 'remote-only' ||
          file.pendingOperationId ||
          file.availability !== 'active'
        )
          return this.result('ineligible')
        if (this.eligible(head.path, head.size))
          return this.result(this.eligible(head.path, head.size)!)
        if (await this.options.host.exists(head.path)) return this.result('collision')
        if (opts.signal?.aborted) return this.result('busy')
        try {
          if (!(await this.verified(id, { ...head, path: head.wirePath })))
            return this.result('version-changed')
        } catch (error) {
          return this.reason(error)
        }
        const sidecar =
          file.projectionPath &&
          file.projectionSha &&
          (await this.options.host.exists(file.projectionPath))
            ? {
                operationId: opts.operationId,
                path: file.projectionPath,
                sha: file.projectionSha,
                size: (await this.options.host.read(file.projectionPath)).length,
                role: 'projection' as const,
              }
            : null
        const retained = sidecar
          ? { ...sidecar, path: quarantine, role: 'retained' as const }
          : null
        const artifact = {
          operationId: opts.operationId,
          path: staging,
          sha: head.sha,
          size: head.size,
          role: 'incoming' as const,
        }
        const op: ExternalOperation = {
          schema: 1,
          operationId: opts.operationId,
          kind: 'hydration',
          phase: 'download-intent',
          revision: 0,
          connectionGeneration: doc.binding.generation,
          expected: {
            fileId: id,
            versionId: head.versionId,
            path: head.wirePath,
            sha: head.sha,
            size: head.size,
          },
          sourcePath: staging,
          targetPath: head.path,
          previousRepresentation: 'remote-only',
          localBase: file.lastProvenLocalBase,
          desiredRepresentation: 'hydrated',
          desiredAvailability: 'active',
          projectionDigest: file.projectionSha,
          ownedArtifacts: [artifact],
          unresolvedOutcome: null,
          cleanupReason: null,
        }
        const pending = {
          ...file,
          localRevision: file.localRevision + 1,
          pendingOperationId: opts.operationId,
          representation: 'pending-download' as const,
        }
        await this.commit(pending, op)
        phase = 'download-intent'
        if (opts.signal?.aborted) return this.result('recovery-required')
        let bytes: Uint8Array
        try {
          bytes = await this.options.download(id, head.versionId, head.sha)
        } catch (error) {
          return this.reason(error)
        }
        this.owned()
        if (bytes.length !== head.size || (await sha256(bytes)) !== head.sha)
          return this.result('version-changed')
        const staged = await effects.stage(artifact, bytes)
        if (staged.status !== 'staged') return this.result('recovery-required')
        // A second disk read ensures the installer consumes the bytes recorded in the intent.
        const reread = await this.options.host.read(staging)
        if (reread.length !== head.size || (await sha256(reread)) !== head.sha)
          return this.result('local-changed')
        const ready = { ...op, phase: 'ready-to-install' as const, revision: 1 }
        await this.commit({ ...pending, localRevision: pending.localRevision + 1 }, ready)
        phase = 'ready-to-install'
        if (opts.signal?.aborted) return this.result('recovery-required')
        let installed
        try {
          installed = await effects.install(artifact, head.path)
        } catch (error) {
          return this.reason(error)
        }
        if (installed.status !== 'installed') return this.result('recovery-required')
        const hydrated = {
          ...pending,
          localRevision: pending.localRevision + 2,
          representation: 'hydrated' as const,
          pendingOperationId: opts.operationId,
          blockingReason: 'cleanup-pending',
        }
        // Persist installation evidence and retirement ownership BEFORE moving the sidecar.
        // Keep quarantine bytes: no hash-then-unlink permission for user-editable artifacts.
        const cleanup = {
          ...ready,
          revision: 2,
          phase: 'cleanup-pending' as const,
          cleanupReason: 'projection-retirement',
          ownedArtifacts: retained ? [artifact, retained] : [artifact],
        }
        await this.commit(hydrated, cleanup)
        phase = 'cleanup-pending'
        if (opts.signal?.aborted || !sidecar || !retained) return this.result('cleanup-pending')
        const retired = await effects.retire(sidecar, retained)
        if (retired.status !== 'retired') return this.result('cleanup-pending')
        await this.commit(
          {
            ...hydrated,
            localRevision: hydrated.localRevision + 1,
            pendingOperationId: null,
            blockingReason: null,
            projectionPath: null,
            projectionSha: null,
            lastProvenLocalBase: {
              fileId: id,
              versionId: head.versionId,
              path: head.wirePath,
              sha: head.sha,
              size: head.size,
              mtime: head.mtime,
            },
            retained: [...file.retained, retained, ...(installed.sourceRetained ? [artifact] : [])],
          },
          { ...cleanup, revision: 3, phase: 'hydrated', cleanupReason: null }
        )
        return this.result('complete')
      }
    )
  }
  async read(
    id: string,
    opts: { expectedVersionId: string }
  ): Promise<{ bytes: Uint8Array; versionId: string } | OperationResult> {
    const lease = this.acquireUse(id)
    try {
      const file = await this.snapshot(id),
        head = await this.head(id)
      if (!head || head.versionId !== opts.expectedVersionId) return this.result('version-changed')
      const reason = this.eligible(head.path, head.size)
      if (reason) return this.result(reason)
      if (file?.availability !== 'active') return this.result('unavailable')
      let bytes: Uint8Array
      if (file?.representation !== 'hydrated') {
        try {
          if (!(await this.verified(id, { ...head, path: head.wirePath })))
            return this.result('version-changed')
        } catch (error) {
          return this.reason(error)
        }
      }
      try {
        bytes =
          file?.representation === 'hydrated'
            ? await this.options.host.read(head.path)
            : await this.options.download(id, head.versionId, head.sha)
      } catch (error) {
        return this.reason(error)
      }
      this.owned()
      if (bytes.length !== head.size || (await sha256(bytes)) !== head.sha)
        return this.result('version-changed')
      return { bytes, versionId: head.versionId }
    } finally {
      lease.release()
    }
  }
  async setPinned(id: string, pinned: boolean): Promise<OperationResult> {
    return this.options.serial.run(async () => {
      const doc = await this.document(),
        file = doc.files.find((f) => f.fileId === id)
      const head = await this.head(id)
      if (!head || this.eligible(head.path, head.size)) return this.result('ineligible')
      if (file?.pendingOperationId) return this.result('busy')
      const next: ExternalRecord = file
        ? {
            ...file,
            pinned,
            preference: pinned ? 'keep-local' : 'on-demand',
            localRevision: file.localRevision + 1,
          }
        : {
            schema: 1,
            ledgerId: doc.ledgerId,
            binding: doc.binding,
            fileId: id,
            representation: 'hydrated',
            preference: pinned ? 'keep-local' : 'on-demand',
            pinned,
            projectionPath: null,
            projectionSha: null,
            localRevision: 0,
            pendingOperationId: null,
            availability: 'active',
            blockingReason: null,
            lastProvenLocalBase: {
              fileId: id,
              versionId: head.versionId,
              path: head.wirePath,
              sha: head.sha,
              size: head.size,
              mtime: head.mtime,
            },
            retained: [],
          }
      await this.commit(next)
      return this.result(
        pinned && next.representation !== 'hydrated' ? 'cleanup-pending' : 'complete'
      )
    })
  }
  acquireUse(id: string): { release(): void } {
    this.owned()
    return this.options.host.acquireUse(id)
  }
  async recover(): Promise<{ pending: number }> {
    return this.options.serial.run(async () => {
      const document = await this.document()
      for (const op of document.operations) {
        if (op.kind === 'hydration' && op.phase === 'cleanup-pending' && op.expected) {
          const file = document.files.find((f) => f.fileId === op.expected!.fileId)
          const retired = op.ownedArtifacts.find((artifact) => artifact.role === 'retained')
          const head = await this.head(op.expected.fileId)
          // Installation was acknowledged and committed before retirement. Never infer
          // installation from equal bytes in ready-to-install, nor issue another rename.
          if (
            !file ||
            file.representation !== 'hydrated' ||
            file.pendingOperationId !== op.operationId ||
            !retired ||
            !head ||
            head.versionId !== op.expected.versionId ||
            head.sha !== op.expected.sha ||
            head.wirePath !== op.expected.path ||
            head.size !== op.expected.size ||
            !file.projectionPath ||
            (await this.options.host.exists(file.projectionPath)) ||
            !(await this.options.host.exists(retired.path)) ||
            !(await this.options.host.exists(head.path))
          )
            continue
          const bytes = await this.options.host.read(retired.path),
            original = await this.options.host.read(head.path)
          if (
            bytes.length !== retired.size ||
            (await sha256(bytes)) !== retired.sha ||
            original.length !== head.size ||
            (await sha256(original)) !== head.sha
          )
            continue
          const retained = [...file.retained, retired]
          for (const artifact of op.ownedArtifacts)
            if (artifact.role === 'incoming' && (await this.options.host.exists(artifact.path)))
              retained.push(artifact)
          await this.commit(
            {
              ...file,
              localRevision: file.localRevision + 1,
              pendingOperationId: null,
              blockingReason: null,
              projectionPath: null,
              projectionSha: null,
              retained,
              lastProvenLocalBase: {
                fileId: head.fileId,
                versionId: head.versionId,
                path: head.wirePath,
                sha: head.sha,
                size: head.size,
                mtime: head.mtime,
              },
            },
            { ...op, revision: op.revision + 1, phase: 'hydrated', cleanupReason: null }
          )
          continue
        }
        if (op.kind !== 'eviction' || op.phase !== 'delete-ready' || !op.expected) continue
        const file = document.files.find((f) => f.fileId === op.expected?.fileId)
        if (!file || file.pendingOperationId !== op.operationId || !file.projectionSha) continue
        if (await this.options.host.exists(op.expected.path)) continue // Never repeat deletion on restart.
        const sidecar = op.targetPath
        if (!sidecar || !(await this.options.host.exists(sidecar))) continue
        const bytes = await this.options.host.read(sidecar)
        if ((await sha256(bytes)) !== op.projectionDigest) continue
        await this.commit(
          {
            ...file,
            localRevision: file.localRevision + 1,
            representation: 'remote-only',
            pendingOperationId: null,
          },
          { ...op, revision: op.revision + 1, phase: 'remote-only' }
        )
      }
      return { pending: (await this.document()).files.filter((f) => f.pendingOperationId).length }
    })
  }
  async inspectDisconnect(): Promise<{ safe: boolean }> {
    return { safe: !(await this.document()).files.length }
  }
  async materializeForDisconnect(): Promise<OperationResult> {
    return this.result('recovery-required')
  }
}
