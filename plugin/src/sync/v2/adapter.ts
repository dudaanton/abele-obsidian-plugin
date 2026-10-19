import { z } from 'zod'
import { V2CommitRequestSchema, V2CommitResponseSchema } from './contract'
import type { V2Change, V2CommitOp, V2CommitResponse, V2ManifestItem } from './contract'
import type { LocalStorage } from '../ledgerId'

const journalSchema = z
  .object({
    requestId: z.string().min(1),
    ops: z.unknown(),
    receipt: z.unknown(),
  })
  .strict()
  // Shared protocol schemas use Zod 3; parse them outside the local Zod 4 envelope.
  .transform((value) => ({
    ...value,
    ops: V2CommitRequestSchema.shape.ops.parse(value.ops),
    receipt: V2CommitResponseSchema.nullable().parse(value.receipt),
  }))

/** Implement with the connection's device-local state, never settings transfer. */
export interface TokenJournal {
  read(): unknown
  write(value: unknown): void
}
/** Pass registry.storage(localId), so equal space IDs on different endpoints never share it. */
export function tokenJournalOf(local: LocalStorage): TokenJournal {
  const key = 'abele-sync-token-state:commit'
  return {
    read: () => local.loadLocalStorage(key),
    write: (value) => local.saveLocalStorage(key, value),
  }
}
export interface TokenDeliveryHost {
  content(item: V2ManifestItem, previousPath: string | null): Promise<void>
  coveredElsewhere(fileId: string, path: string): Promise<boolean>
  /** Remove this connection's baseline; retaining a file is never a global delete. */
  departure(fileId: string, path: string, retainLocal: boolean): Promise<void>
  deletion(change: Extract<V2Change, { type: 'delete' }>): Promise<void>
}
export function eligibleOperations(
  scanned: readonly V2CommitOp[],
  held: (op: V2CommitOp) => boolean,
  budget: number
): V2CommitOp[] {
  if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('Invalid operation budget')
  return scanned.filter((op) => !held(op)).slice(0, budget)
}

/** Access boundary for the retained engine; contains no filesystem or duplicate scanner. */
export class TokenEngineAdapter {
  constructor(
    private readonly client: {
      commit(ops: V2CommitOp[], requestId: string): Promise<V2CommitResponse>
    },
    private readonly journal: TokenJournal
  ) {}
  private persist(value: z.infer<typeof journalSchema> | null): void {
    this.journal.write(value)
    if (JSON.stringify(this.journal.read()) !== JSON.stringify(value))
      throw new Error('Token commit journal requires recovery')
  }
  async submit(
    ops: V2CommitOp[],
    requestId: string,
    settle: (receipt: V2CommitResponse, ops: V2CommitOp[]) => Promise<void>
  ): Promise<void> {
    if (this.journal.read() != null) throw new Error('A token commit is pending')
    this.persist(journalSchema.parse({ requestId, ops, receipt: null }))
    await this.resume(settle)
  }
  async resume(
    settle: (receipt: V2CommitResponse, ops: V2CommitOp[]) => Promise<void>
  ): Promise<void> {
    const saved = this.journal.read()
    if (saved == null) return
    const pending = journalSchema.parse(saved)
    if (pending.receipt === null) {
      const receipt = V2CommitResponseSchema.parse(
        await this.client.commit(pending.ops, pending.requestId)
      )
      if (receipt.results.length !== pending.ops.length)
        throw new Error('Invalid token commit receipt')
      pending.receipt = receipt
      // Persist the accepted outcome before any content fetch or host placement.
      this.persist(pending)
    }
    await settle(pending.receipt, pending.ops)
    this.persist(null)
  }
  async receive(change: V2Change, host: TokenDeliveryHost): Promise<void> {
    switch (change.type) {
      case 'content':
        return host.content(change.item, change.prev_path)
      case 'delete':
        return host.deletion(change)
      case 'removal':
        return host.departure(
          change.file_id,
          change.path,
          await host.coveredElsewhere(change.file_id, change.path)
        )
    }
  }
}
