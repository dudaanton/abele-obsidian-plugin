import type { ChatMessage } from './types'
import type { Message } from './client'

/**
 * Walk parentId chain from leaf to root, return ordered root-first path.
 * Falls back to flat array order for old chats without parentId links.
 */
export function getPathToLeaf(messages: ChatMessage[], leafId: string): ChatMessage[] {
  const map = new Map(messages.map((m) => [m.id, m]))
  const path: ChatMessage[] = []
  let current = map.get(leafId)

  while (current) {
    path.unshift(current)
    current = current.parentId ? map.get(current.parentId) : undefined
  }

  return path
}

/**
 * Find all messages that share the same parentId as the given message (including itself).
 * Sorted by timestamp to keep stable ordering.
 */
export function getSiblings(messages: ChatMessage[], messageId: string): ChatMessage[] {
  const map = new Map(messages.map((m) => [m.id, m]))
  const target = map.get(messageId)
  if (!target) return []

  const parentId = target.parentId
  return messages.filter((m) => m.parentId === parentId).sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Get direct children of a message, sorted by timestamp.
 */
export function getChildren(messages: ChatMessage[], parentId: string): ChatMessage[] {
  return messages.filter((m) => m.parentId === parentId).sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * From a starting message, follow the first (oldest) child at each level to find the deepest leaf.
 */
export function findDeepestLeaf(messages: ChatMessage[], startId: string): ChatMessage {
  const childrenMap = new Map<string | undefined, ChatMessage[]>()
  for (const m of messages) {
    const pid = m.parentId
    if (!childrenMap.has(pid)) childrenMap.set(pid, [])
    childrenMap.get(pid).push(m)
  }
  // Sort children by timestamp
  for (const children of childrenMap.values()) {
    children.sort((a, b) => a.timestamp - b.timestamp)
  }

  let currentId = startId
  const map = new Map(messages.map((m) => [m.id, m]))

  while (true) {
    const children = childrenMap.get(currentId)
    if (!children?.length) break
    currentId = children[0].id
  }

  return map.get(currentId) || map.get(startId)
}

/**
 * Find the default leaf of the whole tree (last message in a flat chat, or deepest first-child path from root).
 */
export function findDefaultLeaf(messages: ChatMessage[]): ChatMessage | undefined {
  if (messages.length === 0) return undefined

  // Old flat chat — no parentId links
  if (!messages.some((m) => m.parentId)) {
    return messages[messages.length - 1]
  }

  // Find root(s) — messages with no parentId
  const roots = messages.filter((m) => !m.parentId).sort((a, b) => a.timestamp - b.timestamp)
  if (roots.length === 0) return messages[messages.length - 1]

  return findDeepestLeaf(messages, roots[0].id)
}

/**
 * Given a ChatMessage path, collect the corresponding internal messages in order.
 * Falls back to returning all internal messages for old chats without chatMessageId.
 */
export function getInternalMessagesForPath(path: ChatMessage[], allInternal: Message[]): Message[] {
  const ids = new Set(path.map((m) => m.id))
  return allInternal.filter((m) => !m.chatMessageId || ids.has(m.chatMessageId))
}

/**
 * Backfill parentId on a flat ChatMessage array (old chats).
 * Converts linear order to a parentId chain. No-op if any message already has parentId.
 */
export function backfillParentIds(messages: ChatMessage[]): void {
  if (messages.some((m) => m.parentId)) return
  for (let i = 1; i < messages.length; i++) {
    messages[i].parentId = messages[i - 1].id
  }
}

/**
 * Backfill chatMessageId on internal messages using positional matching with ChatMessages.
 * Only for old chats where no chatMessageId exists yet.
 */
export function backfillChatMessageIds(
  chatMessages: ChatMessage[],
  internalMessages: Message[]
): void {
  if (internalMessages.some((m) => m.chatMessageId)) return
  if (chatMessages.length === 0 || internalMessages.length === 0) return

  // Build lookup helpers
  const assistantChatMsgs = chatMessages.filter((m) => m.role === 'assistant')
  const toolCallChatMsgs = chatMessages.filter((m) => m.role === 'tool-call')
  const userChatMsgs = chatMessages.filter((m) => m.role === 'user')
  const systemChatMsgs = chatMessages.filter((m) => m.role === 'system')

  let aIdx = 0
  let uIdx = 0
  let sIdx = 0

  for (const msg of internalMessages) {
    if (msg.role === 'user' && uIdx < userChatMsgs.length) {
      msg.chatMessageId = userChatMsgs[uIdx].id
      uIdx++
    } else if (msg.role === 'assistant' && aIdx < assistantChatMsgs.length) {
      msg.chatMessageId = assistantChatMsgs[aIdx].id
      aIdx++
    } else if (msg.role === 'toolResult') {
      const chatMsg = toolCallChatMsgs.find((m) => m.toolCallId === msg.toolCallId)
      if (chatMsg) msg.chatMessageId = chatMsg.id
    } else if (msg.role === 'system' && sIdx < systemChatMsgs.length) {
      msg.chatMessageId = systemChatMsgs[sIdx].id
      sIdx++
    }
  }
}
