import type { ChatMessage } from './types'
import { findDefaultLeaf, getPathToLeaf } from './chatTree'
import { parseChat } from './ChatLog'

/** A chat log's extension — chats, comments and delegated runs alike. */
export const CHAT_EXTENSION = 'abchat'

export function isChatLog(path: string): boolean {
  return path.toLowerCase().endsWith(`.${CHAT_EXTENSION}`)
}

/** Same ceiling as a text file attached to a message. */
const MAX_CHAT_TEXT = 100 * 1024

/** One thing somebody said in a chat: the person or the agent, and nothing in between. */
export interface ChatLine {
  role: 'user' | 'assistant'
  text: string
}

/**
 * The branch of a chat that is on screen, root first.
 *
 * A chat file holds every branch ever taken; the one somebody sees is the path to the leaf the
 * file records as active, or the default one when it records none. A chat saved before branches
 * existed has no parent links at all and is one branch as it stands.
 */
export function activeBranch(messages: ChatMessage[], activeLeafId?: string): ChatMessage[] {
  if (!messages.some((m) => m.parentId)) return messages
  const leaf =
    (activeLeafId && messages.some((m) => m.id === activeLeafId) && activeLeafId) ||
    findDefaultLeaf(messages)?.id
  return leaf ? getPathToLeaf(messages, leaf) : []
}

/**
 * What the person and the agent said to each other — and only that.
 *
 * This is the whole of what leaves a chat when something outside it reads it: a summary for the
 * history, or another agent the chat was attached to. So it is built by *admitting* what is
 * known to be conversation, never by removing what is known not to be: a message is let
 * through only when it is a user or assistant message whose `content` is a plain string, and
 * only that string is taken from it. Tool calls, their arguments and results, diffs, maps,
 * reasoning, compaction summaries, delegated runs, the attachments a message carried and the
 * interceptor's side conversation are all left behind — whatever shape a future field takes,
 * it is not read unless this function is changed to read it.
 *
 * A draft the interceptor is still holding was never sent, so it is not part of the chat yet.
 */
export function conversationLines(messages: ChatMessage[]): ChatLine[] {
  const lines: ChatLine[] = []
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (message.draft === true) continue
    if (typeof message.content !== 'string') continue
    const text = message.content.trim()
    if (!text) continue
    lines.push({ role: message.role, text })
  }
  return lines
}

/** The lines as a transcript, one paragraph each, labelled with who said it. */
export function renderLines(lines: ChatLine[], perLine?: number): string {
  const cut = (text: string) =>
    perLine && text.length > perLine ? `${text.slice(0, perLine)}…` : text
  return lines.map((line) => `[${line.role}]: ${cut(line.text)}`).join('\n\n')
}

/**
 * Another chat as an agent may read it: the words exchanged, and nothing that chat's own agent
 * was shown.
 *
 * The file holds everything the other agent saw — notes it read, what its tools returned, its
 * reasoning — and the agent reading it now may have no access to any of that. So the only thing
 * taken out of it is `conversationLines` of the branch that is on screen, under a header saying
 * what was left out. A conversation longer than the ceiling keeps its end, which is where it got
 * to, and says that the start was cut.
 */
export function chatForAgent(content: string, name: string): string {
  const parsed = parseChat(content)
  if (parsed.metadata?.type !== 'abele-chat') return `[Not a chat: ${name}]`

  const title = parsed.metadata.title || name
  const lines = conversationLines(activeBranch(parsed.messages, parsed.metadata.activeLeafId))
  const header =
    `--- Chat: ${title} ---\n` +
    'Another conversation, attached for reference. Only what the person and the agent wrote is ' +
    'included; its tool calls, their results and its reasoning are not.'

  if (!lines.length) return `${header}\n\n[No messages]`

  const blocks = lines.map((line) => renderLines([line]))
  let size = 0
  let start = blocks.length
  while (start > 0 && size + blocks[start - 1].length + 2 <= MAX_CHAT_TEXT) {
    size += blocks[start - 1].length + 2
    start--
  }
  // A single message longer than the ceiling is cut rather than dropped.
  if (start === blocks.length) {
    return `${header}\n\n[... earlier messages omitted]\n\n${blocks[start - 1].slice(-MAX_CHAT_TEXT)}`
  }
  const cut = start > 0 ? '[... earlier messages omitted]\n\n' : ''
  return `${header}\n\n${cut}${blocks.slice(start).join('\n\n')}`
}
