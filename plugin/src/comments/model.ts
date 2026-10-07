import { z } from 'zod'
import { HIGHLIGHT_COLORS } from '@/editor/highlightColors'
import { COMMENT_ID_RE } from '@/editor/commentMarkers'

export const COMMENT_APPEARANCES = ['underline', ...HIGHLIGHT_COLORS] as const
export type CommentAppearance = (typeof COMMENT_APPEARANCES)[number]
const id = z.string().regex(COMMENT_ID_RE)
const timestamp = z.string().refine((value) => {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}, 'Expected a full UTC timestamp')
const schema = z
  .object({
    version: z.literal(1),
    id,
    anchor: z
      .object({
        note: z
          .string()
          .min(1)
          .refine((path) => path.endsWith('.md')),
        quote: z.string().min(1),
      })
      .strict(),
    appearance: z.enum(COMMENT_APPEARANCES),
    entries: z
      .array(
        z
          .object({
            id,
            body: z.string().refine((body) => !!body.trim()),
            createdAt: timestamp,
            editedAt: timestamp.optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict()
  .refine(
    (thread) => new Set(thread.entries.map((entry) => entry.id)).size === thread.entries.length,
    'Duplicate entry ids'
  )

export type CommentThread = z.infer<typeof schema>
export type CommentEntry = CommentThread['entries'][number]

/** Identity is checked against the filename, not trusted from the JSON body. */
export function decodeThread(content: string, expectedId: string): CommentThread {
  const thread = schema.parse(JSON.parse(content))
  if (thread.id !== expectedId) throw new Error('Comment identity does not match its file')
  return thread
}
export function encodeThread(thread: CommentThread): string {
  return JSON.stringify(schema.parse(thread), null, 2) + '\n'
}
export function appearanceClass(appearance: CommentAppearance): string {
  return appearance === 'underline'
    ? 'abele-comment__quote'
    : `abele-highlight abele-highlight--${appearance}`
}
