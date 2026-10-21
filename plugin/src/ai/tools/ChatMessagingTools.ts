import type { AgentTool } from '../client'
import type { ChatSession } from '../ChatSession'
import { chatMessaging, resolveLetterChat } from '../chatMessaging'
import { LetterRefusal, type LetterChat } from '@/chats/chatLetters'
import { t } from '@/i18n'

export function createChatMessagingTools(owner?: ChatSession, metadata = false): AgentTool[] {
  const tools: AgentTool[] = [
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
        if (!session.canSendChatLetter) throw new Error('This turn cannot send chat letters')
        if (typeof params.chat_id !== 'string' || typeof params.message !== 'string')
          throw new Error('chat_id and message must be strings')
        const target = resolveLetterChat(params.chat_id)
        const to: LetterChat = target
          ? { id: target.id, title: target.title, folder: target.folder, path: target.path }
          : { id: params.chat_id, title: t('chat.letterUnknown'), unknown: true }
        session.attachChatLetter(id, { to })
        await session.save()
        try {
          if (ctx && session.letterAuthority(params).length && !ctx.approved)
            throw new Error('Sending to this chat requires owner approval')
          const reply = await chatMessaging.send(session.id, to.id, params.message, signal)
          to.path =
            chatMessaging.list(session.id).find((chat) => chat.id === to.id)?.path ?? to.path
          session.attachChatLetter(id, { to, reply })
          return { content: [{ type: 'text', text: reply }] }
        } catch (error) {
          const refusal =
            error instanceof LetterRefusal
              ? t(`chat.letterRefusal.${error.reason}`, { title: error.title })
              : error instanceof Error
                ? error.message
                : String(error)
          session.attachChatLetter(id, {
            to,
            refusal,
          })
          throw new Error(refusal)
        } finally {
          await session.save()
        }
      },
    },
  ]
  return tools.filter(
    (tool) => tool.name !== 'send_message_to_chat' || metadata || owner?.canSendChatLetter
  )
}
