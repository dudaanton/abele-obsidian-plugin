import { z } from 'zod'
import { TargetLocationSchema } from './nodeTargetIdentity'
import type { TreeEntry, FileChange } from '@/components/nodeWork/types'
const id = z.string().min(1).max(128)
const text = z.string().max(4096)
const chat = z
  .object({
    id,
    title: text,
    when: text,
    running: z.boolean().optional(),
    unseen: z.boolean().optional(),
    waiting: z.boolean().optional(),
    failed: z.boolean().optional(),
    bypass: z.boolean().optional(),
    since: z.number().optional(),
  })
  .strict()
const copy = z
  .object({
    id,
    kind: z.enum(['project', 'worktree', 'detached']),
    branch: text,
    path: text,
    changed: z.number().int().nonnegative(),
    missing: z.boolean().optional(),
    unseen: z.number().int().nonnegative().optional(),
    running: z.boolean().optional(),
    ahead: z.number().int().nonnegative().optional(),
    behind: z.number().int().nonnegative().optional(),
    lastCommit: text.optional(),
    chats: z.array(chat).max(256).optional(),
  })
  .strict()
const folder = z
  .object({
    id,
    name: text,
    path: text,
    git: z.boolean(),
    missing: z.boolean().optional(),
    copies: z.array(copy).max(256),
    chats: z.array(chat).max(256).optional(),
  })
  .strict()
const change = z
  .object({
    path: text,
    kind: z.enum(['modified', 'added', 'deleted', 'renamed', 'conflict']),
    stage: z.enum(['staged', 'unstaged', 'partly']).optional(),
    changeId: id.optional(),
    partlyStaged: z.boolean().optional(),
    when: text.optional(),
    unseen: z.boolean().optional(),
    from: text.optional(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    before: z.literal(''),
    after: z.literal(''),
  })
  .strict()
const tree: z.ZodType<TreeEntry> = z.lazy(() =>
  z
    .object({
      path: text,
      name: text,
      kind: z.enum(['folder', 'file']),
      children: z.array(tree).max(10000).optional(),
      change: change.optional(),
    })
    .strict()
)
const target = z
  .object({
    nodeId: id,
    registrationId: id,
    projectId: id,
    kind: z.enum(['worktree', 'workspace']),
    id,
    incarnation: id.optional(),
    location: TargetLocationSchema.optional(),
  })
  .strict()
/** Presentation cache, not wire payloads, credentials, byte storage or chat authorization. */
export const NodePathSnapshotSchema = z
  .object({
    version: z.literal(1),
    nodeId: id,
    registrationId: id,
    receivedAt: z.string().datetime(),
    selected: text,
    comparisonBases: z.record(id, text).optional(),
    panelMode: z.enum(['files', 'changes', 'history', 'pulls', 'sessions']).optional(),
    folders: z.array(folder).max(256),
    targets: z.array(target).max(1024),
    inspection: z
      .object({
        entries: z.array(tree).max(10000),
        changes: z.array(change).max(10000),
        ahead: z.number().int().nonnegative().optional(),
        behind: z.number().int().nonnegative().optional(),
        base: text.optional(),
        lastCommit: text.optional(),
        note: text.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) =>
    value.targets.every(
      (t) => t.nodeId === value.nodeId && t.registrationId === value.registrationId
    )
  )
export type NodePathSnapshot = z.infer<typeof NodePathSnapshotSchema>
export const emptySnapshotChange = (value: FileChange) => ({
  ...value,
  before: '' as const,
  after: '' as const,
})
