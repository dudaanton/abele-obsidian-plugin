import { computed, type Ref } from 'vue'
import type { ChatMessage } from './types'
import type { ChatSession } from './ChatSession'

export type ChatReference =
  | { kind: 'local-chat'; chatFilePath: string | null }
  | {
      kind: 'node-session'
      nodeId: string
      registrationId: string
      sessionId: string
      title: string
    }

export interface ChatCapabilities {
  branches: boolean
  rewind: boolean
  editHistory: boolean
  attachments: boolean
  vaultResources: boolean
}

/** Presentation only: neither remote journals nor their tools are local ChatSessions. */
export interface ChatPresentationSession {
  readonly id: string
  readonly reference: ChatReference
  readonly capabilities: ChatCapabilities
  readonly label: Readonly<Ref<string>>
  readonly messages: Readonly<Ref<ChatMessage[]>>
  readonly isStreaming: Readonly<Ref<boolean>>
  send(text: string): Promise<void>
}

/** Thin view of the existing execution path; no new local lifetime or persistence. */
export class LocalChatPresenter implements ChatPresentationSession {
  readonly capabilities = {
    branches: true,
    rewind: true,
    editHistory: true,
    attachments: true,
    vaultResources: true,
  }
  readonly label: Readonly<Ref<string>>
  constructor(readonly session: ChatSession) {
    this.label = computed(() => session.chatTitle.value || 'New chat')
  }
  get id() {
    return this.session.id
  }
  get reference(): ChatReference {
    return { kind: 'local-chat', chatFilePath: this.session.currentChatFile.value?.path ?? null }
  }
  get messages() {
    return this.session.messages
  }
  get isStreaming() {
    return this.session.isStreaming
  }
  async send(text: string): Promise<void> {
    await this.session.sendMessage(text)
  }
}
