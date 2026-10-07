import { nanoid } from 'nanoid'
import type { ChatSnapshot } from './ChatLog'
import { getPathToLeaf, backfillChatMessageIds } from './chatTree'
import type { ChatMetadata } from './types'

/** File records are JSON data; copying this way also accepts Vue's reactive wrappers. */
export function copyChatData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** A fresh conversation, not another branch or another writer on the source's identities. */
export function cloneChatPath(source: ChatSnapshot, messageId: string): ChatSnapshot | null {
  const path = getPathToLeaf(source.messages, messageId)
  if (!path.length || path.some((message) => message.draft)) return null
  const ids = new Map(path.map((message) => [message.id, nanoid()]))
  const messages = copyChatData(path).map((message) => {
    message.id = ids.get(message.id)!
    message.parentId = message.parentId ? ids.get(message.parentId) : undefined
    // These locate selections and revision proposals in the original conversation.
    delete message.selection
    delete message.decorationOperations
    delete message.replyProposal
    for (const revision of message.revisions ?? []) {
      delete revision.beforeRevisionId
      delete revision.afterRevisionId
    }
    return message
  })
  // Apply the existing positional migration for wholly unlinked legacy history. In
  // particular load() does not migrate an old chat containing just its first message.
  const history = copyChatData(source.internalMessages ?? [])
  backfillChatMessageIds(source.messages, history)
  // Never fall back to all remaining unlinked history: it can contain later turns.
  const internalMessages = history.filter(
    (message) => message.chatMessageId && ids.has(message.chatMessageId)
  )
  const completedCalls = new Set(
    internalMessages.filter((m) => m.role === 'toolResult').map((m) => m.toolCallId)
  )
  for (const message of internalMessages) {
    message.chatMessageId = ids.get(message.chatMessageId!)!
    if (message.role !== 'assistant') continue
    // A provider reply bundles text and several calls, while the UI gives each call a row.
    // Cutting before/between those rows must not include calls beyond the chosen point, or
    // leave an unmatched tool call in the next request. Nothing here executes a call.
    message.content = message.content.filter(
      (part) => part.type !== 'toolCall' || completedCalls.has(part.id)
    )
    if (
      message.stopReason === 'toolUse' &&
      !message.content.some((part) => part.type === 'toolCall')
    )
      message.stopReason = 'stop'
  }
  const setup = source.metadata
  const metadata: ChatMetadata = copyChatData({
    type: 'abele-chat',
    title: `${setup.title || 'Chat'} (копия)`,
    created: new Date().toISOString().slice(0, 10),
    providerId: setup.providerId,
    modelId: setup.modelId,
    agentId: setup.agentId,
    overrides: setup.overrides,
    revealedToolGroups: setup.revealedToolGroups,
    customSystemPrompt: setup.customSystemPrompt,
    customSystemPromptNotePath: setup.customSystemPromptNotePath,
    interceptorAgentId: setup.interceptorAgentId,
    interceptorContextDepth: setup.interceptorContextDepth,
    interceptorReplyOnly: setup.interceptorReplyOnly,
    interceptorScript: setup.interceptorScript,
    interceptorPattern: setup.interceptorPattern,
    activeLeafId: messages.at(-1)!.id,
  })
  // `touched` is chat-wide (including manual links). Only explicit writes on this path
  // prove a link belongs here, with that write's time, not a later sibling's timestamp.
  const linked = new Set(setup.touched?.map((note) => note.path))
  const writes = new Map<string, number>()
  for (const message of internalMessages) {
    if (message.role !== 'user' && message.role !== 'toolResult') continue
    for (const read of message.reads ?? []) {
      if (read.via === 'write' && linked.has(read.path))
        writes.set(read.path, Math.max(writes.get(read.path) ?? 0, read.at))
    }
  }
  if (writes.size)
    metadata.touched = [...writes].map(([path, at]) => ({ path, at: new Date(at).toISOString() }))
  return { metadata, messages, internalMessages }
}
