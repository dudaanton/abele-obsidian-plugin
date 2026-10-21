import { ChatLetters, type LetterEndpoint } from '@/chats/chatLetters'
import { ChatService } from './ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'

/** Share navigation metadata with the tree; local delivery still belongs to its session. */
export function openMessagingChats(): LetterEndpoint[] {
  const service = ChatService.getInstance()
  return service.listOpenChats().map((chat) => {
    const session = service.getSession(chat.id)
    const version = session?.conversationVersion.value
    return {
      ...chat,
      path: session?.currentChatFile.value?.path,
      receive: async (message, from, signal) => {
        if (!session) throw new Error('This chat cannot receive cross-chat messages')
        if (session.conversationVersion.value !== version)
          throw new Error('The target chat changed before the message was delivered')
        return session.receiveChatLetter(message, from, signal)
      },
    } satisfies LetterEndpoint
  })
}

export const chatMessaging = new ChatLetters(openMessagingChats)

export async function openLetterChat(
  chat: import('@/chats/chatLetters').LetterChat
): Promise<void> {
  const service = ChatService.getInstance()
  if (service.getSession(chat.id) || service.getNodeSession(chat.id)) service.switchTab(chat.id)
  else if (chat.path) {
    const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(chat.path)
    if (file instanceof TFile) await service.openChatFile(file)
  }
}
