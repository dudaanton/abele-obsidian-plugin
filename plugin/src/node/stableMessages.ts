import type { ChatMessage } from '@/ai/types'

/** Same content: strings and numbers compared directly, nested values by their JSON. */
function same(a: ChatMessage, b: ChatMessage): boolean {
  const keys = Object.keys(a) as (keyof ChatMessage)[]
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) {
    const x = a[key],
      y = b[key]
    if (x === y) continue
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false
    if (JSON.stringify(x) !== JSON.stringify(y)) return false
  }
  return true
}

/**
 * A node chat is reduced from its journal again on every event, giving new objects for every
 * message. This hands back the previous object of each message whose content did not change, so
 * the chat redraws only what changed: a streamed answer does not redraw the messages above it.
 */
export class StableMessages {
  private seen = new Map<string, ChatMessage>()
  private lists = new Map<string, ChatMessage[]>()

  keep(messages: readonly ChatMessage[]): ChatMessage[] {
    const next = new Map<string, ChatMessage>()
    const kept = messages.map((message) => {
      const before = this.seen.get(message.id)
      const chosen = before && same(before, message) ? before : message
      next.set(message.id, chosen)
      return chosen
    })
    this.seen = next
    return kept
  }

  /** The same for the work nested under calls, list by list. */
  children(children: Record<string, ChatMessage[]>): Record<string, ChatMessage[]> {
    const next = new Map<string, ChatMessage[]>()
    const kept: Record<string, ChatMessage[]> = {}
    for (const [parent, list] of Object.entries(children)) {
      const before = this.lists.get(parent)
      kept[parent] =
        before && before.length === list.length && before.every((m, i) => same(m, list[i]))
          ? before
          : list
      next.set(parent, kept[parent])
    }
    this.lists = next
    return kept
  }
}
