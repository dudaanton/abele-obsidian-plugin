import {
  ChatLetters,
  LetterRefusal,
  type LetterChat,
  type LetterEndpoint,
} from '@/chats/chatLetters'
import { ChatService } from './ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'

const knownChats = new WeakMap<ChatService, Map<string, LetterChat>>()

/** Share navigation metadata with the tree; local delivery still belongs to its session. */
export function openMessagingChats(): LetterEndpoint[] {
  const service = ChatService.getInstance()
  const known = knownChats.get(service) ?? new Map<string, LetterChat>()
  knownChats.set(service, known)
  return service.listOpenChats().map((chat) => {
    const session = service.getSession(chat.id)
    const node = service.getNodeSession(chat.id)
    known.set(chat.id, {
      id: chat.id,
      title: chat.title,
      folder: chat.folder,
      path: session?.currentChatFile.value?.path,
    })
    const version = session?.conversationVersion.value
    return {
      ...chat,
      path: session?.currentChatFile.value?.path,
      receive: async (message, from, signal) => {
        if (!session) {
          if (!node || service.getNodeSession(chat.id) !== node)
            throw new LetterRefusal('closed', chat.title)
          return node.receiveChatLetter(message, from, signal)
        }
        if (session.conversationVersion.value !== version)
          throw new Error('The target chat changed before the message was delivered')
        return session.receiveChatLetter(message, from, signal)
      },
    } satisfies LetterEndpoint
  })
}

export function resolveLetterChat(id: string): LetterChat | undefined {
  const service = ChatService.getInstance()
  const open = openMessagingChats().find((chat) => chat.id === id)
  if (open) return { id, title: open.title, folder: open.folder, path: open.path }
  return (
    knownChats.get(service)?.get(id) ??
    service
      .getAllSessions()
      .flatMap((session) =>
        session.messages.value.flatMap((message) =>
          message.chatLetter ? [message.chatLetter.to] : []
        )
      )
      .find((chat) => chat.id === id && !chat.unknown && chat.title !== id)
  )
}

export const chatMessaging = new ChatLetters(openMessagingChats, resolveLetterChat)

export function canOpenLetterChat(chat: LetterChat): boolean {
  const service = ChatService.getInstance()
  return !!(
    service.getSession(chat.id) ||
    service.getNodeSession(chat.id) ||
    (chat.path &&
      GlobalStore.getInstance().app.vault.getAbstractFileByPath(chat.path) instanceof TFile)
  )
}

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
