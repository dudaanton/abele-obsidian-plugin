import { z } from 'zod'

/** The earlier local-storage home of the projection classification cache. */
export const EXTERNAL_INSPECTION_KEY = 'abele-sync-external-inspection-v1'
export const inspectionSchema = z
  .object({
    schema: z.literal(1),
    entries: z.array(
      z
        .object({
          path: z.string(),
          size: z.number().int().nonnegative(),
          mtime: z.number(),
          ctime: z.number().optional(),
          identity: z.string().optional(),
          marker: z.boolean(),
        })
        .strict()
    ),
  })
  .strict()
