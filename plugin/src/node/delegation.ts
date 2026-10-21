import { testNodeProvidersEnabled } from './providers'
import type { ToolPermissions } from './toolPermissions'
import type { Prompt } from '@abele/node-client'
import type { PromptAnswerState } from './promptAnswers'
import { t } from '@/i18n'
import { z } from 'zod'
import { ObsidianToolsSnapshotSchema, type ObsidianToolsSnapshot } from '@abele/node-protocol'
import { DelegationSchema, DelegationStatusSchema } from '@abele/node-protocol'
import type { Delegation, DelegationStatus } from '@abele/node-client'

export const DelegationTaskInputSchema = z
  .object({
    task_key: z.string().min(1).max(128),
    project_id: z.string().min(1).max(128).optional(),
    provider: z
      .enum(['claude', 'pi', 'codex', 'fake'])
      .refine(
        (provider) => provider !== 'fake' || testNodeProvidersEnabled(),
        'Test providers require a sharing-test build'
      ),
    title: z.string().max(256),
    text: z.string().min(1).max(32768),
    base_ref: z.string().min(1).max(256).default('HEAD'),
  })
  .strict()
export type DelegationTaskInput = z.input<typeof DelegationTaskInputSchema>
// Keep retained records readable independently of the build’s provider choices.
const RetainedTaskInputSchema = DelegationTaskInputSchema.extend({
  provider: z.enum(['claude', 'pi', 'codex', 'fake']),
})
const RequestSchema = RetainedTaskInputSchema.omit({ task_key: true })
  .extend({
    parent_id: z.string().min(1).max(128).optional(),
    delegation_key: z.string().min(1).max(128),
    // Retained requests may contain an old node receipt reference. Never select it.
    grant_id: z.string().optional(),
    permission_mode: z.enum(['manual', 'bypassPermissions']).optional(),
    obsidian_tools: z
      .custom<ObsidianToolsSnapshot>(
        (value) => ObsidianToolsSnapshotSchema.safeParse(value).success
      )
      .optional(),
  })
  .strict()
export type DelegationRequest = z.input<typeof RequestSchema>
// Validate retained requests without normalizing their exact retry bodies.
const request = z.custom<DelegationRequest>((value) => RequestSchema.safeParse(value).success)
export const DelegationStorageSchema = z
  .object({
    grants: z.unknown().optional(), // Ignore legacy grants without an approval or migration flow.
    tasks: z.record(
      z.string(),
      z
        .object({
          parentId: z.string().min(1).max(128),
          input: RetainedTaskInputSchema,
          request,
          child: z.custom<Delegation>((v) => DelegationSchema.safeParse(v).success).optional(),
          cancelled: z.boolean().optional(),
          cancelSettled: z.boolean().optional(),
          awaitingResult: z.boolean().optional(),
          notifiedAttention: z.string().optional(),
          permissionRefusal: z.string().optional(),
          parentStopped: z.boolean().optional(),
          followupMailboxSeq: z.number().int().nonnegative().optional(),
          followupAcceptedSeq: z.number().int().nonnegative().optional(),
          status: z
            .custom<DelegationStatus>((v) => DelegationStatusSchema.safeParse(v).success)
            .optional(),
        })
        .strict()
    ),
  })
  .strict()
  .transform(({ tasks }) => ({ tasks }))
export type DelegationStorage = z.infer<typeof DelegationStorageSchema>
export function delegationReportText(text: string): string {
  return /^Waiting for owner approval\. Open child session \S+ to answer prompt \S+\. The controller cannot approve it\.$/.test(
    text
  )
    ? t('node.delegation.ownerAnswer')
    : text
}
/** Older nodes allocate opaque branch names; the task title is their human label. */
export function delegationBranchLabel(branch?: string | null): string | undefined {
  const name = branch?.replace(/^refs\/heads\//, '')
  return name && !/^abele\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(name)
    ? name
    : undefined
}
export interface DelegationCard {
  toolPermissions?: ToolPermissions
  taskKey?: string
  delegationId?: string
  sessionId?: string
  nodeId?: string
  projectId?: string
  workspaceId?: string
  branch?: string
  activity?: { message?: string; tool?: string; files: string[] }
  title: string
  provider: string
  state: string
  reason?: string
  warnings?: string[]
  prompts?: Prompt[]
  answers?: Record<string, PromptAnswerState>
  promptDiffs?: Record<string, { path: string; old: string; new: string }[]>
  pendingHumanPrompts: number
  reports: { seq: number; kind: string; text: string }[]
}
