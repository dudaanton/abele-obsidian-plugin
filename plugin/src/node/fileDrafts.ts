import { z } from 'zod'
import { FileWriteSchema, FileMutationResultSchema } from '@abele/node-protocol'
import type { FileWrite, FileMutationResult } from '@abele/node-client'
/** Installation-local editor state, never settings or a vault file. */
export const FileDraftSchema = z
  .object({
    // Migration adds one stable local CAS identity; each committed change replaces it.
    revision: z
      .string()
      .uuid()
      .default(() => crypto.randomUUID()),
    baseContentId: z.string().regex(/^[a-f0-9]{64}$/),
    baseText: z.string().max(32768),
    text: z.string().max(16 * 1024 * 1024),
    status: z.enum(['draft', 'saved', 'outcome_unknown', 'conflict', 'rejected']),
    pending: z
      .object({
        operationId: z.string().min(1).max(128),
        params: z.custom<FileWrite>((value) => FileWriteSchema.safeParse(value).success),
      })
      .strict()
      .optional(),
    result: z
      .custom<FileMutationResult>((value) => FileMutationResultSchema.safeParse(value).success)
      .optional(),
    error: z.string().optional(),
  })
  .strict()
export type FileDraft = z.infer<typeof FileDraftSchema>
export type FileDraftSnapshot = Pick<FileDraft, 'revision' | 'text' | 'baseContentId'>
