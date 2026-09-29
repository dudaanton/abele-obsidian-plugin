/**
 * What an interceptor script is shown: the message, and the chat around it.
 *
 * Copies, deep-frozen, built when the message is sent. The script reads them; changing them
 * throws in strict mode and would change nothing anyway. What the message should become is said
 * by what the script returns, never by editing these.
 */
import type { AgentDefinition } from '@/ai/agents/types'
import type { ChatMessage, PermissionMode, ToolMode } from '@/ai/types'
import type { InterceptedMessage } from './result'

export interface InterceptChatMessage {
  role: 'user' | 'assistant'
  text: string
  attachments?: string[]
  timestamp: number
}

export interface InterceptChatAgent {
  id: string
  name: string
  description: string
  providerId: string
  modelId: string
  permissionMode: PermissionMode
  toolModes: Record<string, ToolMode>
  fullVaultAccess: boolean
  scope: { type: string; path: string }[]
}

export interface InterceptChat {
  id: string
  title: string
  kind: 'chat' | 'comment'
  /** The chat's file, or null while it has none. */
  path: string | null
  /** The conversation so far, oldest first, without drafts and tool traffic. */
  messages: InterceptChatMessage[]
  /** Every path attached in this chat so far, in the order first attached. */
  attachments: string[]
  /** The note open in the editor when the message was sent, or null. */
  activeNote: string | null
  /** For a comment: the note, or book, it is about. Null in an ordinary chat. */
  note: string | null
  /** The chat's agent as the chat runs it — this chat's own overrides applied. */
  agent: InterceptChatAgent | null
}

export interface InterceptInput {
  message: InterceptedMessage
  chat: InterceptChat
}

/** What the chat knows, gathered by the session; everything here is copied. */
export interface InterceptSource {
  id: string
  title: string
  kind: string
  path: string | null
  messages: ChatMessage[]
  activeNote: string | null
  note: string | null
  agent: AgentDefinition | null
  overrides: {
    providerId: string
    modelId: string
    permissionMode: PermissionMode
    toolModes: Record<string, ToolMode>
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner)
  }
  return value
}

export function buildInterceptInput(
  message: InterceptedMessage,
  source: InterceptSource
): InterceptInput {
  const messages: InterceptChatMessage[] = source.messages
    .filter((m) => !m.draft && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      text: m.content,
      ...(m.attachments?.length ? { attachments: [...m.attachments] } : {}),
      timestamp: m.timestamp,
    }))

  const attachments: string[] = []
  for (const m of messages) {
    for (const path of m.attachments ?? []) if (!attachments.includes(path)) attachments.push(path)
  }

  const agent = source.agent
  const chat: InterceptChat = {
    id: source.id,
    title: source.title,
    kind: source.kind === 'comment' ? 'comment' : 'chat',
    path: source.path,
    messages,
    attachments,
    activeNote: source.activeNote,
    note: source.note,
    agent: agent
      ? {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          providerId: source.overrides.providerId,
          modelId: source.overrides.modelId,
          permissionMode: source.overrides.permissionMode,
          toolModes: { ...source.overrides.toolModes },
          fullVaultAccess: agent.fullVaultAccess,
          scope: agent.scope.map((s) => ({ type: s.type, path: s.path })),
        }
      : null,
  }

  return deepFreeze({
    message: { text: message.text, attachments: [...message.attachments] },
    chat,
  })
}
