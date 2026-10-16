import type { ChatMessage } from '@/ai/types'

/**
 * A node chat is reduced from its journal again on every event, giving new objects for every
 * message. This hands back the previous object of each message whose content did not change, so
 * the chat redraws only what changed: a streamed answer does not redraw the messages above it.
 */
export class StableMessages {
  private seen = new Map<string, { key: string; message: ChatMessage }>()
  private lists = new Map<string, { key: string; list: ChatMessage[] }>()

  keep(messages: readonly ChatMessage[]): ChatMessage[] {
    const next = new Map<string, { key: string; message: ChatMessage }>()
    const kept = messages.map((message) => {
      const key = JSON.stringify(message)
      const before = this.seen.get(message.id)
      const chosen = before && before.key === key ? before.message : message
      next.set(message.id, { key, message: chosen })
      return chosen
    })
    this.seen = next
    return kept
  }

  /** The same for the work nested under calls, list by list. */
  children(children: Record<string, ChatMessage[]>): Record<string, ChatMessage[]> {
    const next = new Map<string, { key: string; list: ChatMessage[] }>()
    const kept: Record<string, ChatMessage[]> = {}
    for (const [parent, list] of Object.entries(children)) {
      const key = JSON.stringify(list)
      const before = this.lists.get(parent)
      kept[parent] = before && before.key === key ? before.list : list
      next.set(parent, { key, list: kept[parent] })
    }
    this.lists = next
    return kept
  }
}
