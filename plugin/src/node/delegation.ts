import { z } from 'zod'
import {
  DelegationSchema,
  DelegationGrantSchema,
  DelegationStatusSchema,
  validateParams,
} from '@abele/node-protocol'
import type {
  Delegation,
  DelegationGrant,
  DelegationStatus,
  DelegationCreateRequest,
} from '@abele/node-client'

export const DelegationTaskInputSchema = z
  .object({
    task_key: z.string().min(1).max(128),
    project_id: z.string().min(1).max(128).optional(),
    provider: z.enum(['claude', 'pi', 'fake']),
    title: z.string().max(256),
    text: z.string().min(1).max(32768),
    base_ref: z.string().min(1).max(256).default('HEAD'),
  })
  .strict()
export type DelegationTaskInput = z.input<typeof DelegationTaskInputSchema>
const request = z.custom<DelegationCreateRequest>((value) => {
  try {
    validateParams('delegation.create', value)
    return true
  } catch {
    return false
  }
})
export const DelegationStorageSchema = z
  .object({
    grants: z.record(
      z.string(),
      z.custom<DelegationGrant>((v) => DelegationGrantSchema.safeParse(v).success)
    ),
    tasks: z.record(
      z.string(),
      z
        .object({
          parentId: z.string().min(1).max(128),
          input: DelegationTaskInputSchema,
          request,
          child: z.custom<Delegation>((v) => DelegationSchema.safeParse(v).success).optional(),
          cancelled: z.boolean().optional(),
          cancelSettled: z.boolean().optional(),
          awaitingResult: z.boolean().optional(),
          status: z
            .custom<DelegationStatus>((v) => DelegationStatusSchema.safeParse(v).success)
            .optional(),
        })
        .strict()
    ),
  })
  .strict()
export type DelegationStorage = z.infer<typeof DelegationStorageSchema>
export interface DelegationCard {
  delegationId?: string
  sessionId?: string
  nodeId?: string
  title: string
  provider: string
  state: string
  pendingHumanPrompts: number
  reports: { seq: number; kind: string; text: string }[]
}
