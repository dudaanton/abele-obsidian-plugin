import type { ChatMessage } from './types'
import { findDefaultLeaf, getPathToLeaf } from './chatTree'

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
