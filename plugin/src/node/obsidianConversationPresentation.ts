import type { InjectionKey, ComputedRef } from 'vue'
import type { NodeClient } from '@abele/node-client'
export const obsidianConversationPresentation: InjectionKey<{
  client: NodeClient
  revision: ComputedRef<unknown>
}> = Symbol('obsidian-conversation-presentation')
