// Retained upload schemas from protocol 10e8f23; receipt follows documented v2 routes.
import { z } from 'zod'
import { ShaSchema } from './fileSchemas'
const id = z.string().min(1)
const bytes = z.number().int().nonnegative()
export const UploadBeginRequestSchema = z.object({ size: z.number().int().positive() })
export type UploadBeginRequest = z.infer<typeof UploadBeginRequestSchema>

export const UploadBeginResponseSchema = z.object({
  upload_id: id,
  part_size: z.number().int().positive(),
  parts: z.number().int().positive(),
  received: z.array(z.number().int().nonnegative()).optional(),
})
export type UploadBeginResponse = z.infer<typeof UploadBeginResponseSchema>

export const UploadReceiptSchema = z.object({ sha: ShaSchema, size: bytes }).strict()
