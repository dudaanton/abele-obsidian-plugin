import type { InjectionKey } from 'vue'
import type { Scope } from 'obsidian'

/**
 * What a chat pane hands the composer inside it: the scope of the chat's tab keys
 * (`chatTabKeys.ts`), for the field to sit on while it has the focus. Its own module so the
 * composer does not have to import the chat service to ask for it.
 */
export const CHAT_KEY_SCOPE: InjectionKey<Scope> = Symbol('chat-key-scope')
