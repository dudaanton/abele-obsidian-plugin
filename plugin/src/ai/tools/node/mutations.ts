import { z } from 'zod'
import type { ClientState, ClientStore } from '@abele/node-client'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

const id = z.string().min(1).max(128)
export const NodeMutationRecordSchema = z
  .object({
    operation_id: id,
    key: z.string().regex(/^[a-f0-9]{64}$/),
    chat_id: id,
    call_id: z.string().min(1).max(1024),
    principal: z.string(),
    tool: z.enum(['node_write', 'node_edit', 'node_replace', 'node_mv', 'node_cp', 'node_rm']),
    request: z.object({ method: z.string(), params: z.unknown() }).strict(),
    before: z.string().max(2 * 1024 * 1024),
    after: z.string().max(2 * 1024 * 1024),
    state: z.enum(['pending', 'outcome_unknown', 'saved', 'applied', 'conflict', 'rejected']),
    receipt: z.unknown().optional(),
  })
  .strict()
export type NodeMutationRecord = z.infer<typeof NodeMutationRecordSchema>
export interface NodeMutationState extends ClientState {
  chatMutations?: Record<string, NodeMutationRecord>
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, canonical(value)])
    )
  return value
}
export function nodeMutationKey(
  chat: string,
  tool: string,
  target: unknown,
  args: unknown
): string {
  return bytesToHex(
    sha256(new TextEncoder().encode(JSON.stringify(canonical({ chat, tool, target, args }))))
  )
}

/** Durable local intent, distinct from the client's effect outbox. Never discard an unresolved ID. */
export class NodeMutationStore {
  constructor(
    private readonly store: ClientStore,
    private readonly newId: () => string = () => crypto.randomUUID()
  ) {}
  async find(
    chat: string,
    key: string,
    call: string,
    operation?: string
  ): Promise<NodeMutationRecord | undefined> {
    return this.store.transaction((raw) => {
      const records = (raw as NodeMutationState).chatMutations ?? {}
      if (operation) {
        const record = Object.hasOwn(records, operation) ? records[operation] : undefined
        if (record && (record.chat_id !== chat || record.key !== key))
          throw new Error('Mutation retry does not match this chat and exact request')
        if (record) return record
      }
      const same = Object.values(records).filter(
        (record) => record.chat_id === chat && record.key === key
      )
      return (
        same.find((record) => record.call_id === call) ??
        same.find((record) => record.state === 'pending' || record.state === 'outcome_unknown')
      )
    })
  }
  async reserve(
    input: Omit<NodeMutationRecord, 'operation_id' | 'state' | 'receipt'>
  ): Promise<NodeMutationRecord> {
    return this.store.transaction((raw) => {
      const state = raw as NodeMutationState,
        records = (state.chatMutations ??= {})
      const existing = Object.values(records).find(
        (record) =>
          record.chat_id === input.chat_id &&
          record.key === input.key &&
          (record.call_id === input.call_id ||
            record.state === 'pending' ||
            record.state === 'outcome_unknown')
      )
      if (existing) return existing
      const record = NodeMutationRecordSchema.parse({
        ...input,
        operation_id: this.newId(),
        state: 'pending',
      })
      if (records[record.operation_id])
        throw new Error('Mutation operation identity already exists')
      records[record.operation_id] = record
      return record
    })
  }
  async settle(
    record: NodeMutationRecord,
    state: NodeMutationRecord['state'],
    receipt?: unknown
  ): Promise<void> {
    await this.store.transaction((raw) => {
      const records = (raw as NodeMutationState).chatMutations
      if (!records?.[record.operation_id] || records[record.operation_id].key !== record.key)
        throw new Error('Mutation intent disappeared or changed')
      const current = records[record.operation_id]
      // Lost publication stays retryable under this ID; any known receipt remains retained.
      records[record.operation_id] = NodeMutationRecordSchema.parse({
        ...current,
        state,
        ...(receipt !== undefined ? { receipt } : {}),
      })
    })
  }
}
