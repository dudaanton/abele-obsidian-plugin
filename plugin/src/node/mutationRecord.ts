import { z } from 'zod'
import type { NodeMutationRecord } from '@/ai/tools/node/mutations'

const packed = z
  .object({
    kind: z.literal('chat-mutation-delta-v1'),
    record: z.record(z.string(), z.unknown()),
    after: z
      .object({
        prefix: z.number().int().nonnegative(),
        suffix: z.number().int().nonnegative(),
        middle: z.string(),
      })
      .strict(),
  })
  .strict()

/** Keep exact retry/diff evidence once a receipt settles a mutation, without two full images. */
export function packMutation(record: NodeMutationRecord): unknown {
  if (!record.receipt || !['saved', 'applied', 'conflict', 'rejected'].includes(record.state))
    return record
  const { before, after } = record
  let prefix = 0
  const limit = Math.min(before.length, after.length)
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++
  let suffix = 0
  while (
    suffix < limit - prefix &&
    before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)
  )
    suffix++
  if (prefix + suffix < 128) return record
  const { after: _after, ...rest } = record
  return {
    kind: 'chat-mutation-delta-v1',
    record: rest,
    after: { prefix, suffix, middle: after.slice(prefix, after.length - suffix) },
  }
}

export function unpackMutation(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('kind' in value)) return value
  const compact = packed.parse(value)
  const before = z.string().parse(compact.record.before)
  const { prefix, suffix, middle } = compact.after
  if (prefix + suffix > before.length) throw new Error('Invalid compact mutation image')
  return {
    ...compact.record,
    after: before.slice(0, prefix) + middle + (suffix ? before.slice(-suffix) : ''),
  }
}
