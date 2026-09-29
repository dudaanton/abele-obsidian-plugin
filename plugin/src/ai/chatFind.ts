import type { ChatMessage } from './types'
import { toolParamsText, toolResultText, toolSummary } from './toolLine'

/**
 * Finding words in a chat: which parts of which messages hold them, counted from what the
 * messages hold rather than from what is on the page.
 *
 * The page holds only the end of a long conversation (`useTailPagedList`), and what is folded
 * away — reasoning, a tool's parameters and result — is not laid out at all. So the count, and
 * the order of next and previous, come from here; the page is asked only for the one match being
 * shown, once its message is mounted and its part unfolded.
 */

/**
 * A part of a message that is drawn on its own and may be folded away. The message element
 * marks each with `data-find-part`, which is how the one holding a match is found on the page.
 */
export type FindPart =
  | 'content'
  | 'thinking'
  | 'tool'
  | 'params'
  | 'result'
  | 'newfile'
  | 'summary'
  | 'interceptor'

/** One occurrence: the message, the part of it, and which occurrence in that part. */
export interface FindMatch {
  messageId: string
  part: FindPart
  /** 0 for the first occurrence in this part, 1 for the second… */
  nth: number
}

/**
 * Text folded for matching: lower case, `ё` as `е`, and every kind of white space a plain space
 * — a line break in the markdown is a space once it is drawn.
 *
 * Always the same length as what it was made from, character for character, so an offset found
 * in the folded text is the same offset in the text on the page.
 */
export function foldText(text: string): string {
  const lower = text.toLowerCase()
  const same = lower.length === text.length ? lower : foldByChar(text)
  return same.replace(/ё/g, 'е').replace(/\s/g, ' ')
}

/** The slow road, for text holding a letter whose lower case is longer than itself (`İ`). */
function foldByChar(text: string): string {
  let out = ''
  for (const ch of text) {
    const lower = ch.toLowerCase()
    out += lower.length === ch.length ? lower : ch
  }
  return out
}

/** A query folded the way the text is, or nothing for one that is only white space. */
export function foldQuery(query: string): string {
  return query.trim() ? foldText(query) : ''
}

/** Where a folded query starts in a folded text, every time, without overlaps. */
export function occurrences(folded: string, query: string): number[] {
  const at: number[] = []
  if (!query) return at
  let from = 0
  for (;;) {
    const i = folded.indexOf(query, from)
    if (i < 0) return at
    at.push(i)
    from = i + query.length
  }
}

/**
 * The parts of a message a person can see, with the text each shows — folded or not.
 *
 * Only what the message draws: a tool result the chat does not show (a successful one's own
 * message) is not searched, and a result longer than the details print is searched as far as
 * they print it.
 */
export function searchableParts(message: ChatMessage): Array<{ part: FindPart; text: string }> {
  const parts: Array<{ part: FindPart; text: string }> = []
  const add = (part: FindPart, text: string | undefined) => {
    if (text) parts.push({ part, text })
  }

  if (message.thinking) add('thinking', message.thinking)

  switch (message.role) {
    case 'user':
    case 'assistant':
      add('content', message.content)
      break
    case 'tool-call':
      add('tool', [message.toolName, toolSummary(message)].filter(Boolean).join(' '))
      if (message.toolDiff && !message.toolDiff.old) add('newfile', message.toolDiff.new)
      if (message.toolParams) add('params', toolParamsText(message.toolParams))
      if (message.toolResult) add('result', toolResultText(message.toolResult))
      break
    case 'tool-result':
      if (message.toolStatus === 'rejected') add('content', message.content)
      break
    case 'system':
      // A compaction's summary folds under a label; a short notice is the label.
      if (message.content.length > 100) add('summary', message.content)
      else add('content', message.content)
      break
  }

  for (const reply of message.interceptorChat ?? []) add('interceptor', reply.content)
  return parts
}

/**
 * Every occurrence of the query in the conversation, in reading order.
 *
 * The interceptor's side conversation is one part made of several replies; each counts in turn.
 */
export function findInMessages(messages: readonly ChatMessage[], query: string): FindMatch[] {
  const q = foldQuery(query)
  const found: FindMatch[] = []
  if (!q) return found

  for (const message of messages) {
    const seen = new Map<FindPart, number>()
    for (const { part, text } of searchableParts(message)) {
      const count = occurrences(foldText(text), q).length
      const before = seen.get(part) ?? 0
      for (let n = 0; n < count; n++) found.push({ messageId: message.id, part, nth: before + n })
      seen.set(part, before + count)
    }
  }
  return found
}

/** The same occurrence in a list found again — after the conversation has changed. */
export function sameMatch(a: FindMatch | null | undefined, b: FindMatch): boolean {
  return !!a && a.messageId === b.messageId && a.part === b.part && a.nth === b.nth
}

/**
 * Which match to start on when the query changes: the first from the message at the top of the
 * view on, so the reader is not thrown back to the start of a long conversation; the last one
 * when every match is above them.
 */
export function startingMatch(
  matches: readonly FindMatch[],
  messages: readonly ChatMessage[],
  topMessageId: string | null
): number {
  if (!matches.length) return -1
  const from = topMessageId ? messages.findIndex((m) => m.id === topMessageId) : -1
  if (from < 0) return matches.length - 1
  const order = new Map(messages.map((m, i) => [m.id, i]))
  const i = matches.findIndex((m) => (order.get(m.messageId) ?? -1) >= from)
  return i < 0 ? matches.length - 1 : i
}

/** A few words either side of a match, cut at word boundaries, for a list of results. */
export interface Snippet {
  before: string
  match: string
  after: string
}

const SNIPPET_RADIUS = 60

export function snippetAt(text: string, at: number, length: number): Snippet {
  let start = Math.max(0, at - SNIPPET_RADIUS)
  let end = Math.min(text.length, at + length + SNIPPET_RADIUS)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space >= 0 && space < at) start = space + 1
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > at + length) end = space
  }
  const flat = (s: string) => s.replace(/\s+/g, ' ')
  return {
    before: (start > 0 ? '…' : '') + flat(text.slice(start, at)).trimStart(),
    match: flat(text.slice(at, at + length)),
    after: flat(text.slice(at + length, end)).trimEnd() + (end < text.length ? '…' : ''),
  }
}
