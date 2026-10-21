import { z } from 'zod'
import type { ChatMessage } from '@/ai/types'
const Part = z.object({
  id: z.string(),
  version: z.number(),
  part: z.number().int().nonnegative(),
  parts: z.number().int().positive(),
  text: z.string(),
})
/** Fold complete immutable message versions; never replace one with an incomplete append. */
export function foldDelegateHistory(records: unknown[]): ChatMessage[] {
  const versions = new Map<string, Map<number, { parts: number; text: Map<number, string> }>>()
  for (const raw of records) {
    const parsed = Part.safeParse(raw)
    if (!parsed.success) continue
    const part = parsed.data,
      message = versions.get(part.id) ?? new Map()
    const version = message.get(part.version) ?? { parts: part.parts, text: new Map() }
    if (version.parts !== part.parts || part.part >= part.parts) continue
    version.text.set(part.part, part.text)
    message.set(part.version, version)
    versions.set(part.id, message)
  }
  const result: ChatMessage[] = []
  for (const [id, versionsById] of versions) {
    for (const [, version] of [...versionsById].sort(([a], [b]) => b - a)) {
      if (version.text.size !== version.parts) continue
      try {
        const raw = JSON.parse(
          Array.from({ length: version.parts }, (_, i) => version.text.get(i)).join('')
        ) as ChatMessage
        if (
          raw.id === id &&
          ['user', 'assistant', 'tool-call', 'system'].includes(raw.role) &&
          typeof raw.content === 'string'
        )
          result.push(raw)
      } catch {
        /* A malformed retained row cannot become a chat message. */
      }
      break
    }
  }
  return result.sort((a, b) => a.timestamp - b.timestamp)
}
