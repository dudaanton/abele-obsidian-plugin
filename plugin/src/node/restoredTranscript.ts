import type { JournalEvent } from '@abele/channel-protocol'
import { z } from 'zod'
import { t } from '@/i18n'
const Restored = z.object({
  source_session_id: z.string().min(1),
  before_seq: z.number().int().min(0),
  exclude_input_ids: z.array(z.string()).default([]),
})
export async function restoredTranscript(
  events: readonly JournalEvent[],
  read: (session: string, before: number) => Promise<JournalEvent[]>
): Promise<JournalEvent[]> {
  const visiting = new Set<string>()
  const walk = async (history: readonly JournalEvent[], depth: number): Promise<JournalEvent[]> => {
    const index = history.findLastIndex((event) => event.type === 'chat.restored')
    if (index < 0) return [...history]
    const marker = history[index]
    const data = Restored.parse(marker.data)
    const key = `${data.source_session_id}:${data.before_seq}`
    if (depth > 64 || visiting.has(key)) throw new Error(t('streamB.nodeHistoryCannotRead'))
    visiting.add(key)
    const source = await read(data.source_session_id, data.before_seq)
    const prefix = await walk(
      source.filter((event) => event.seq <= data.before_seq),
      depth + 1
    )
    visiting.delete(key)
    const excluded = new Set(data.exclude_input_ids)
    return [
      ...prefix.filter((event) => {
        const d = event.data as {
          input_id?: string
          update?: { kind?: string; message_id?: string }
        } | null
        if (event.type.startsWith('input.') && d?.input_id && excluded.has(d.input_id)) return false
        return !(
          event.type === 'session.update' &&
          d?.update?.kind === 'user_message' &&
          excluded.has(d.update.message_id ?? '')
        )
      }),
      ...history.slice(index),
    ]
  }
  if (!events.some((event) => event.type === 'chat.restored')) return [...events]
  // Raw journals keep their original sequence and source. The disposable projection gets
  // one order across inherited prefixes, whose independent sequence numbers may overlap.
  return (await walk(events, 0)).map((event, index) => ({ ...event, seq: index + 1 }))
}
