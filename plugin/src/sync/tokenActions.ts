import {
  readDeleteDecision,
  type SyncEngine,
  type StateStore,
  type EngineClient,
  type DeleteDecision,
} from '@abele/sync-sdk/core'
import { caseKey, type ChangeItem, type CommitOp, type CommitOpResult } from '@abele/sync-sdk/protocol'
import type { DeferredSettingsBatch } from './stagedSettings'
/** Reports exact receipts rather than inferring success from absent ledger entries. */
export class TokenActions {
  private deleteTail: Promise<void> = Promise.resolve()
  private applyTail: Promise<void> = Promise.resolve()
  private deleteClient: EngineClient | null = null
  private deleteTargets: Set<string> | null = null
  private deleteReceipts: Set<string> | null = null
  private applyWrites: Set<string> | null = null
  private applyTarget: ChangeItem | null = null
  constructor(
    private readonly engine: SyncEngine,
    private readonly store: StateStore,
    private readonly vault: EngineClient
  ) {}
  written(path: string): void {
    this.applyWrites?.add(path)
  }
  decideDeletes(
    kind: DeleteDecision['kind'],
    fileIds: readonly string[]
  ): Promise<{ decided: number; applied: boolean; completed?: number } | null> {
    const ids = [...fileIds]
    const work = this.deleteTail.then(() => this.decideDeleteBatch(kind, ids))
    this.deleteTail = work.then(
      (): void => undefined,
      (): void => undefined
    )
    return work
  }

  private async decideDeleteBatch(
    kind: DeleteDecision['kind'],
    fileIds: readonly string[]
  ): Promise<{ decided: number; applied: boolean; completed?: number } | null> {
    const engine = this.engine
    if (engine === null) return null
    const store = this.store
    const held = new Set((await engine.heldDeletes()).map((one) => one.fileId))
    const targets = new Set(fileIds.filter((id) => held.has(id)))
    const decided = targets.size
    this.deleteClient = this.vault
    this.deleteTargets = targets
    this.deleteReceipts = new Set()
    try {
      const result = await engine.decideDeletes(kind, fileIds)
      if (kind === 'confirm' && result.report !== null) {
        const completed = this.deleteReceipts.size
        if (completed !== result.decided)
          return { decided: result.decided, applied: false, completed }
      }
      return { decided: result.decided, applied: result.report !== null }
    } catch (error) {
      const filed = store === null ? null : await readDeleteDecision(store)
      const waiting =
        filed?.kind === kind &&
        fileIds.filter((id) => held.has(id)).every((id) => filed.fileIds.includes(id))
      // A put-back can consume its decision before a network failure: the durable rewind and
      // dropped hold still carry it out next time. A failed decision write has neither proof.
      const restored =
        kind === 'restore' && !(await engine.heldDeletes()).some((one) => held.has(one.fileId))
      if (!waiting && !restored) throw error
      return { decided, applied: false }
    } finally {
      this.deleteClient = null
      this.deleteTargets = null
      this.deleteReceipts = null
    }
  }

  recordDeleteResults(vault: EngineClient, ops: CommitOp[], results: CommitOpResult[]): void {
    if (
      vault !== this.deleteClient ||
      this.deleteReceipts === null ||
      results.length !== ops.length
    )
      return
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      const result = results[i]
      if (
        op.op === 'delete' &&
        this.deleteTargets?.has(op.file_id) &&
        result.status !== 'rejected' &&
        result.file_id === op.file_id &&
        result.sha === null
      ) {
        this.deleteReceipts.add(op.file_id)
      }
    }
  }

  applyDeferred(versionIds: readonly string[]): Promise<DeferredSettingsBatch | null> {
    const work = this.applyTail.then(() => this.applyBatch(versionIds))
    this.applyTail = work.then(
      (): void => undefined,
      (): void => undefined
    )
    return work
  }

  private async applyBatch(versionIds: readonly string[]): Promise<DeferredSettingsBatch | null> {
    const engine = this.engine
    if (engine === null) return null
    const requested = new Set(versionIds)
    const shown = (await engine.deferred()).filter((one) => requested.has(one.version_id))
    const applied = new Set<string>()
    const skipped = new Set<string>()
    const failed: { path: string; reason: string }[] = []
    for (const one of shown) {
      const writes = new Set<string>()
      this.applyWrites = writes
      this.applyTarget = one
      try {
        // One file per exclusive operation: if a later one fails, the completed outcomes are
        // still available. Actual write receipts also cover a ledger error after a file write.
        const result = await engine.applyDeferred([one.version_id])
        result.applied.forEach((path) => applied.add(path))
        result.skipped.forEach((path) => skipped.add(path))
      } catch (error) {
        failed.push({
          path: one.path,
          reason: error instanceof Error ? error.message : String(error),
        })
      } finally {
        if (
          [...writes].some((path) =>
            [one.path, one.prev_path].some(
              (target) => target !== null && caseKey(target) === caseKey(path)
            )
          )
        )
          applied.add(one.path)
        this.applyWrites = null
        this.applyTarget = null
      }
    }
    let unshown: ChangeItem[] = []
    let incomplete: string | undefined
    try {
      unshown = (await engine.deferred()).filter((one) => !requested.has(one.version_id))
    } catch (error) {
      incomplete = error instanceof Error ? error.message : String(error)
    }
    return {
      applied: [...applied],
      skipped: [...skipped],
      unshown,
      ...(failed.length ? { failed } : {}),
      ...(incomplete ? { incomplete } : {}),
    }
  }
}
