import { z } from 'zod'
import { UploadBeginRequestSchema as SharedUploadBeginRequestSchema } from '@abele/sync-sdk/protocol'

export { UploadBeginResponseSchema } from '@abele/sync-sdk/protocol'
export type { UploadBeginResponse } from '@abele/sync-sdk/protocol'

// Optional upstream upload fields remain unknown fields for the plugin's v2 request.
export const UploadBeginRequestSchema = SharedUploadBeginRequestSchema.pick({ size: true })
export type UploadBeginRequest = typeof UploadBeginRequestSchema._output

// Keep local until the planned public V2UploadReceiptSchema export is available.
export const UploadReceiptSchema = z
  .object({ sha: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().int().nonnegative() })
  .strict()
