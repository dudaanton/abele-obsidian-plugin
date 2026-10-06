import { z } from 'zod'
export const GrantPreparationSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), state: z.string().min(1) }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string().min(1), message: z.string() }),
  }),
])
export type GrantPreparation = z.infer<typeof GrantPreparationSchema>
export const preparationOf = (value: unknown): GrantPreparation | undefined =>
  value === undefined ? undefined : GrantPreparationSchema.parse(value)
