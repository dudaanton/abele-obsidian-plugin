import { t } from '@/i18n'
import { reactive, ref } from 'vue'
import type { ChatTreeEntry, ChatTreeKind, ChatTreeSource, ChatTreeState } from '@/chats/chatTree'

const folds = new WeakMap<ChatTreeSource, Set<string>>()
export const foldsOf = (source: ChatTreeSource): Set<string> => {
  let folded = folds.get(source)
  if (!folded) {
    folded = reactive(new Set<string>())
    folds.set(source, folded)
  }
  return folded
}

/** Reveal the current path without changing unrelated groups. */
export function revealCurrentChat(
  entries: ChatTreeEntry[],
  id: string,
  folded: Set<string>
): boolean {
  const visit = (items: ChatTreeEntry[], folder: string, nested: boolean): boolean => {
    for (const entry of items) {
      const current = entry.kind === 'chat' && entry.id === id
      const contains =
        !current &&
        visit(
          entry.children ?? [],
          entry.kind === 'folder' ? entry.path : folder,
          entry.kind === 'chat'
        )
      if (current || contains) {
        if (contains) folded.delete(entry.kind === 'folder' ? entry.path : `chat:${entry.id}`)
        if (entry.kind === 'chat' && !entry.open && !nested) folded.add(`${folder}#closed`)
        return true
      }
    }
    return false
  }
  return visit(entries, '', false)
}

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
