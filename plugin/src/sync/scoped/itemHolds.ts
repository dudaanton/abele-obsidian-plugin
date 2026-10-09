import {
  ScopedJournalSchema,
  type ScopedJournal,
  type ScopedState,
  type StateStore,
} from '@abele/sync-core'
import { AbeleError, ScopedCommitRequestSchema } from '@abele/sync-protocol'

const ITEM_HOLDS = 'scoped-item-holds-v1'
export interface ItemHold {
  ops: ScopedJournal['ops']
  journal: ScopedJournal | null
  code: string
  message: string
}
function parseHold(value: unknown): ItemHold {
  if (!value || typeof value !== 'object') throw new Error('Scoped item holds require recovery')
  const input = value as Record<string, unknown>
  if (
    typeof input.code !== 'string' ||
    typeof input.message !== 'string' ||
    Object.keys(input).some((key) => !['ops', 'journal', 'code', 'message'].includes(key))
  )
    throw new Error('Scoped item holds require recovery')
  const ops = ScopedCommitRequestSchema.shape.ops.parse(input.ops)
  const journal = ScopedJournalSchema.nullable().parse(input.journal)
  if (journal && JSON.stringify(ops) !== JSON.stringify(journal.ops))
    throw new Error('Scoped item holds require recovery')
  return { ops, journal, code: input.code, message: input.message }
}
type Store = Pick<StateStore, 'getMeta' | 'setMeta' | 'transaction'>

export async function readScopedItemHolds(raw: Store): Promise<ItemHold[]> {
  const value = await raw.getMeta?.(ITEM_HOLDS)
  if (value == null) return []
  const values: unknown = JSON.parse(value)
  if (!Array.isArray(values)) throw new Error('Scoped item holds require recovery')
  return values.map(parseHold)
}

/** Archive before vacating, in one durable transaction. Staged source files remain intact. */
export async function holdScopedItem(
  raw: Store,
  state: ScopedState,
  op: ScopedJournal['ops'][number],
  error: AbeleError
): Promise<ItemHold[]> {
  if (!raw.setMeta) throw new Error('Durable scoped item holds unavailable')
  await raw.transaction(async () => {
    const journal = await state.getJournal()
    const hold = parseHold({
      ops: journal?.ops ?? [op],
      journal,
      code: error.code,
      message: error.message,
    })
    const holds = await readScopedItemHolds(raw)
    holds.push(hold)
    await raw.setMeta(ITEM_HOLDS, JSON.stringify(holds))
    await state.setJournal(null)
  })
  return readScopedItemHolds(raw)
}
