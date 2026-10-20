import type { AgentTool } from '../client'
import type { ChatSession } from '../ChatSession'
import { chatMessaging, openMessagingChats } from '../chatMessaging'
import type { LetterChat } from '@/chats/chatLetters'

export function createChatMessagingTools(owner?: ChatSession): AgentTool[] {
  return [
    {
      name: 'list_chats',
      label: 'List chats',
      description:
        'List other open chats with their id, title, folder, agent and state. Closed chats and this chat are omitted.',
      parameters: { type: 'object', properties: {} },
      execute: async (_id, _params, _signal, ctx) => {
        const session = ctx?.session ?? owner
        if (!session) throw new Error('No active chat')
        return { content: [{ type: 'text', text: JSON.stringify(chatMessaging.list(session.id)) }] }
      },
    },
    {
      name: 'send_message_to_chat',
      label: 'Send message to chat',
      description:
        'Ask another open chat a question and wait for its final answer. It works in its own chat with its own tools and permissions. Use an id from list_chats. Cannot message yourself, a closed chat or a chat waiting for you.',
      parameters: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Target id from list_chats.' },
          message: { type: 'string', description: 'The message to send.' },
        },
        required: ['chat_id', 'message'],
      },
      execute: async (id, params, signal, ctx) => {
        const session = ctx?.session ?? owner
        if (!session) throw new Error('No active chat')
        if (typeof params.chat_id !== 'string' || typeof params.message !== 'string')
          throw new Error('chat_id and message must be strings')
        const target = openMessagingChats().find((chat) => chat.id === params.chat_id)
        const to: LetterChat = target
          ? { id: target.id, title: target.title, folder: target.folder, path: target.path }
          : { id: params.chat_id, title: params.chat_id }
        session.attachChatLetter(id, { to })
        await session.save()
        try {
          const reply = await chatMessaging.send(session.id, to.id, params.message, signal)
          to.path =
            chatMessaging.list(session.id).find((chat) => chat.id === to.id)?.path ?? to.path
          session.attachChatLetter(id, { to, reply })
          return { content: [{ type: 'text', text: reply }] }
        } catch (error) {
          session.attachChatLetter(id, {
            to,
            refusal: error instanceof Error ? error.message : String(error),
          })
          throw error
        } finally {
          await session.save()
        }
      },
    },
  ]
}
