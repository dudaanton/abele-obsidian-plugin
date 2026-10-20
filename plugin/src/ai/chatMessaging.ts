import { ChatLetters, type LetterEndpoint } from '@/chats/chatLetters'
import { ChatService } from './ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'
import { t } from '@/i18n'

/** Temporary adapter; the chat tree's open-chat directory can replace this one function. */
export function openMessagingChats(): LetterEndpoint[] {
  const service = ChatService.getInstance()
  return service.tabOrder.value.flatMap((id) => {
    const session = service.getSession(id)
    if (!session || session.isDestroyed || session.kind === 'run') return []
    const path = session.currentChatFile.value?.parent?.path ?? ''
    const version = session.conversationVersion.value
    return [
      {
        id,
        title:
          session.chatTitle.value ||
          session.messages.value.find((m) => m.role === 'user')?.content.slice(0, 80) ||
          t('streamB.newChat.db1838'),
        folder: path,
        path: session.currentChatFile.value?.path,
        agent: session.agent.value?.name ?? '',
        state: session.error.value
          ? 'error'
          : session.pendingToolCalls.value.length || session.pendingQuestions.value
            ? 'waiting'
            : session.isMidTurn || session.isExecutingTool.value
              ? 'working'
              : 'idle',
        receive: async (message, from, signal) => {
          if (session.conversationVersion.value !== version)
            throw new Error('The target chat changed before the message was delivered')
          return session.receiveChatLetter(message, from, signal)
        },
      } satisfies LetterEndpoint,
    ]
  })
}

export const chatMessaging = new ChatLetters(openMessagingChats)

export async function openLetterChat(
  chat: import('@/chats/chatLetters').LetterChat
): Promise<void> {
  const service = ChatService.getInstance()
  if (service.getSession(chat.id)) service.switchTab(chat.id)
  else if (chat.path) {
    const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(chat.path)
    if (file instanceof TFile) await service.openChatFile(file)
  }
}
