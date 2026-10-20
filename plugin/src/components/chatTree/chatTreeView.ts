import { t } from '@/i18n'
import { ref } from 'vue'
import type { ChatTreeKind, ChatTreeState } from '@/chats/chatTree'

/** The chat being dragged onto a folder, by id. */
export const dragged = ref<string | null>(null)

/** Every word of the query is in the title. */
export const matches = (title: string, query: string) => {
  const t = title.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => t.includes(w))
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A nested chat's glyph, by what it is to the chat it was opened from. */
export const KIND_ICON: Record<ChatTreeKind, string | undefined> = {
  chat: undefined,
  discussion: 'messages-square',
  helper: 'bot',
  node: 'server',
}
export const KIND_WORDS: Record<ChatTreeKind, string> = {
  get chat() {
    return t('chatTree.chat')
  },
  get discussion() {
    return t('chatTree.discussion')
  },
  get helper() {
    return t('chatTree.helper')
  },
  get node() {
    return t('chatTree.node')
  },
}

export const STATE_WORDS: Record<ChatTreeState, string> = {
  get waiting() {
    return t('chatTree.waiting')
  },
  get working() {
    return t('chatTree.working')
  },
  get failed() {
    return t('chatTree.failed')
  },
}
