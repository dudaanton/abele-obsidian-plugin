import { computed, type ComputedRef } from 'vue'
import { ChatStorage } from '@/ai/ChatStorage'
import { ChatLink } from '@/entities/ChatLink'
import { GlobalStore } from '@/stores/GlobalStore'

/**
 * The chats that wrote to `notePath()`, most recent write to that note first.
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

    return ChatStorage.getInstance()
      .getHistory()
      .filter((entry) => entry.notes?.some((note) => note.path === path))
      .map((entry) => new ChatLink(entry, path))
      .sort((a, b) => (b.touchedAt?.valueOf() ?? 0) - (a.touchedAt?.valueOf() ?? 0))
  })
}
