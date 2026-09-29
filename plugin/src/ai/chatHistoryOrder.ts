import type { TFile } from 'obsidian'
import type { AiChatHistoryEntry } from './types'

/**
 * How the history of chats is ordered: by when each was last written in (the default), or by
 * when each was started. Both dates come out of the chat's own messages (`messageTimes`), kept on
 * its index entry; the creation date stands in when no sent turn has a date. Modification time
 * never dates a conversation: summaries and sync change it without anybody writing a message.
 */
export type HistoryOrder = 'last' | 'created'

export const HISTORY_ORDERS: { value: HistoryOrder; display: string }[] = [
  { value: 'last', display: 'Last message' },
  { value: 'created', display: 'Date created' },
]

/** Where this device keeps the order last chosen: one person's habit, not the vault's. */
export const HISTORY_ORDER_KEY = 'abele-chat-history-order'

export function isHistoryOrder(value: unknown): value is HistoryOrder {
  return value === 'last' || value === 'created'
}

/** A `created` day (`YYYY-MM-DD`, or a full ISO time from older chats) as local midnight or the time. */
function createdTime(created: string): number {
  if (!created) return 0
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(created)
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime()
  const at = Date.parse(created)
  return Number.isFinite(at) ? at : 0
}

/** The moment a chat stands at in the order asked for; 0 when nothing at all is known. */
export function historyDate(
  entry: AiChatHistoryEntry,
  order: HistoryOrder,
  file: TFile | null
): number {
  if (order === 'last' && entry.lastMessageAt) return entry.lastMessageAt
  return entry.firstMessageAt || createdTime(entry.created) || file?.stat.ctime || 0
}

/** Newest first. A copy: the index itself keeps its own order. */
export function sortHistory(
  entries: readonly AiChatHistoryEntry[],
  order: HistoryOrder,
  fileOf: (path: string) => TFile | null
): AiChatHistoryEntry[] {
  const at = new Map(entries.map((e) => [e.path, historyDate(e, order, fileOf(e.path))]))
  return [...entries].sort((a, b) => (at.get(b.path) ?? 0) - (at.get(a.path) ?? 0))
}
