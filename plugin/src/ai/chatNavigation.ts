import type { ChatMessage, MessageComment } from './types'
import {
  foldQuery,
  foldText,
  searchableParts,
  snippetAt,
  type FindPart,
  type Snippet,
} from './chatFind'
import { toolSummary } from './toolLine'
import { backfillParentIds, reattachOrphans, findDefaultLeaf } from './chatTree'

/** Project a file snapshot like an opened chat, repairing only local copies of its messages. */
export function navigationPath(
  messages: readonly ChatMessage[],
  activeLeafId?: string
): ChatMessage[] {
  const local = messages.map((message) => ({ ...message }))
  backfillParentIds(local)
  reattachOrphans(local)
  const byId = new Map(local.map((message) => [message.id, message]))
  let current: ChatMessage | undefined =
    (activeLeafId ? byId.get(activeLeafId) : undefined) ?? findDefaultLeaf(local)
  const path: ChatMessage[] = []
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path.reverse()
}

/** Memory only, owned by the chat view for each conversation lifetime. */
export interface NavigationState {
  expanded: string[]
  scrollTop: number
}

/** One sent question and the work after it, from the current projected path, never the log. */
export interface NavigationTurn {
  message: ChatMessage
  answers: ChatMessage[]
  tools: ChatMessage[]
  discussions: MessageComment[]
  attention: boolean
}

/** A compact label, not a rewrite of the text or its stored anchor. */
export function navigationExcerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 100 ? flat.slice(0, 99) + '…' : flat
}

export function navigationTitle(message: ChatMessage): string {
  const text =
    message.role === 'tool-call'
      ? [message.toolName, toolSummary(message)].filter(Boolean).join(' · ')
      : message.content.replace(/\s+/g, ' ').trim()
  if (text) return navigationExcerpt(text)
  const files = message.attachments ?? []
  if (files.length > 1) return `${files.length} attachments`
  if (files.length === 1)
    return /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(files[0])
      ? 'Image'
      : `File: ${files[0].split('/').pop()}`
  return message.role === 'user' ? 'Message' : 'Answer'
}

export function buildChatNavigation(
  messages: readonly ChatMessage[],
  comments: readonly MessageComment[]
): NavigationTurn[] {
  const rows: NavigationTurn[] = []
  const owners = new Map<string, NavigationTurn>()
  let row: NavigationTurn | undefined
  for (const message of messages) {
    if (message.draft) continue
    // Successful standalone tool results are not drawn in the feed either.
    if (message.role === 'tool-result' && message.toolStatus !== 'rejected') continue
    if (message.role === 'user' || !row) {
      row = { message, answers: [], tools: [], discussions: [], attention: false }
      rows.push(row)
    } else if (message.role === 'tool-call') row.tools.push(message)
    else row.answers.push(message)
    if (
      message.toolStatus === 'pending' ||
      message.toolStatus === 'rejected' ||
      message.subAgentRun?.status === 'error'
    )
      row.attention = true
    owners.set(message.id, row)
  }
  for (const comment of comments) owners.get(comment.message)?.discussions.push(comment)
  return rows
}

export interface NavigationHit {
  messageId: string
  part: FindPart
  snippet: Snippet
  timestamp: number
}

/** One snippet per matching visible part. No reads of discussions or other branches. */
export function searchChatNavigation(
  messages: readonly ChatMessage[],
  query: string
): NavigationHit[] {
  const q = foldQuery(query)
  if (!q) return []
  const hits: NavigationHit[] = []
  for (const message of messages) {
    if (message.draft) continue
    const seen = new Set<FindPart>()
    for (const { part, text } of searchableParts(message)) {
      const at = foldText(text).indexOf(q)
      if (at < 0 || seen.has(part)) continue
      seen.add(part)
      hits.push({
        messageId: message.id,
        part,
        snippet: snippetAt(text, at, q.length),
        timestamp: message.timestamp,
      })
    }
  }
  return hits
}
