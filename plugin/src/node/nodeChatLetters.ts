import { z } from 'zod'

export const NodeLetterSchema = z.object({
  sessionId: z.string(),
  from: z.object({
    id: z.string(),
    title: z.string(),
    folder: z.string().optional(),
    path: z.string().optional(),
  }),
  inputId: z.string().optional(),
  turnId: z.string().optional(),
  status: z.enum(['pending', 'completed', 'interrupted']),
})
export type NodeLetter = z.infer<typeof NodeLetterSchema>
/** Only this process can finish an admitted letter; reconnect never replays it. */
export const activeNodeLetters = new Set<string>()
