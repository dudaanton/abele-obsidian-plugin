import { computed, type ComputedRef } from 'vue'
import { chatsOf } from '@/ai/chatNoteLinks'
import { ChatLink } from '@/entities/ChatLink'
import { GlobalStore } from '@/stores/GlobalStore'

/**
 * The chats linked to `notePath()` — by writing to it or by hand — most recent link first.
 *
 * Reads `chatLinksVersion` before anything else, and that is the whole point of the ref: the
 * index lives in `AbeleConfig.ai.chatHistory`, a plain object that is not a Vue proxy, so a
 * computed over it would be evaluated once and never again. The counter is the dependency.
 *
 * Nothing is scanned per note: this filters an array already in memory.
 */
export function useChatLinks(notePath: () => string): ComputedRef<ChatLink[]> {
  return computed(() => {
    void GlobalStore.getInstance().chatLinksVersion.value

    const path = notePath()
    if (!path) return []

    return chatsOf(path)
      .map((entry) => new ChatLink(entry, path))
      .sort((a, b) => (b.touchedAt?.valueOf() ?? 0) - (a.touchedAt?.valueOf() ?? 0))
  })
}
