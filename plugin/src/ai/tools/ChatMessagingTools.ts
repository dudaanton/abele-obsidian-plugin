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
        'Send work or a question to another open chat. Use wait=false for big handoffs: return when queued, then receive its final answer as an incoming letter without waking this chat. Use wait=true (the default) for quick questions to return the final answer as this tool result. The target uses its own tools and permissions. Use an id from list_chats. Cannot message yourself, a closed chat or a chat waiting for you.',
      parameters: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Target id from list_chats.' },
          message: { type: 'string', description: 'The message to send.' },
          wait: {
            type: 'boolean',
            description: 'Wait for the final answer (default true). Set false for long work.',
          },
        },
        required: ['chat_id', 'message'],
      },
      execute: async (id, params, signal, ctx) => {
        const session = ctx?.session ?? owner
        if (!session) throw new Error('No active chat')
        if (!session.canSendChatLetter) throw new Error('This turn cannot send chat letters')
        if (typeof params.chat_id !== 'string' || typeof params.message !== 'string')
          throw new Error('chat_id and message must be strings')
        if (params.wait !== undefined && typeof params.wait !== 'boolean')
          throw new Error('wait must be a boolean')
        const target = resolveLetterChat(params.chat_id)
        const to: LetterChat = target
          ? { id: target.id, title: target.title, folder: target.folder, path: target.path }
          : { id: params.chat_id, title: t('chat.letterUnknown'), unknown: true }
        session.attachChatLetter(id, { to })
        await session.save()
        try {
          if (ctx && session.letterAuthority(params).length && !ctx.approved)
            throw new Error('Sending to this chat requires owner approval')
          if (params.wait === false) {
            if (signal?.aborted) throw new Error('Message cancelled')
            const version = session.conversationVersion.value
            let queued = false
            await new Promise<void>((resolve, reject) => {
              // Once accepted, the handoff belongs to the target, not the sender's turn signal.
              void chatMessaging
                .send(session.id, to.id, params.message as string, undefined, () => {
                  queued = true
                  resolve()
                })
                .then(
                  async (reply) => {
                    if (session.conversationVersion.value !== version) return
                    to.path =
                      chatMessaging.list(session.id).find((chat) => chat.id === to.id)?.path ??
                      to.path
                    session.attachChatLetter(id, { to, reply })
                    await session.receiveChatLetterReply(reply, to, version)
                  },
                  async (error: unknown) => {
                    reject(error instanceof Error ? error : new Error(String(error)))
                    if (!queued || session.conversationVersion.value !== version) return
                    const refusal =
                      error instanceof LetterRefusal
                        ? t(`chat.letterRefusal.${error.reason}`, { title: error.title })
                        : error instanceof Error
                          ? error.message
                          : String(error)
                    session.attachChatLetter(id, { to, refusal })
                    await session.receiveChatLetterReply(refusal, to, version)
                  }
                )
                .catch((error) => console.error('[Abele chat message reply]', error))
            })
            return {
              content: [
                {
                  type: 'text',
                  text: 'Message queued. The final answer will arrive as an incoming letter; do not wait.',
                },
              ],
            }
          }
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
