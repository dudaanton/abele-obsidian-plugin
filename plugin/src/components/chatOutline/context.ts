// What every row of a chat's outline shares, handed down once instead of through each level:
// which rows are open, and how a discussion is read for its title and its own discussions.
import { inject, provide, type InjectionKey } from 'vue'
import type { NavigationDiscussionData } from '@/ai/chatNavigationDiscussionSearch'

export interface OutlineContext {
  isOpen: (key: string) => boolean
  flip: (key: string) => void
  /** A discussion's chat as stored, or null when it is gone, unreadable or not synced yet. */
  preview: (id: string) => Promise<NavigationDiscussionData | null>
}

const key: InjectionKey<OutlineContext> = Symbol('chat-outline')

export const provideOutline = (context: OutlineContext) => provide(key, context)

export function useOutline(): OutlineContext {
  const context = inject(key)
  if (!context) throw new Error('A chat outline row is drawn outside its outline')
  return context
}
