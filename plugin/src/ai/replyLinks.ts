import type { ChatReplyTo } from './types'

/**
 * Replies inside a question: places of the agent's words, each standing in the person's text
 * where it was put, the person's own words between them.
 *
 * Three shapes of the same thing:
 * - in the composer, each place is a token in the text — self-contained, so a draft, an undo or a
 *   queued message restored to the field carries it without anything kept beside the text;
 * - in a sent question, the text holds the person's words only and `replyTo` says where each
 *   place stands in it (`at`);
 * - for the agent, a block of links over the text — which message, which words, a few opening
 *   words to know it by — and a marker where each stands. Never the agent's words again.
 */

/** Around a token in the composer. Private-use characters: nothing types them, markdown ignores them. */
export const REPLY_OPEN = ''
export const REPLY_CLOSE = ''
const TOKEN = /([A-Za-z0-9_-]*)/g

/** A whole answer is answered by its opening: more than this and the card says nothing more. */
export const WHOLE_QUOTE_CHARS = 280
/** What the agent is shown of a place, to know it by: its opening words, at most this many. */
export const OPENING_WORDS = 8

/** Runs of white space read as one: a place is told by its words, not its line breaks. */
export const quoteWords = (text: string) => text.replace(/\s+/g, ' ').trim()

/** A whole message as a place: its opening, cut at a word, with an ellipsis when it goes on. */
export function wholeQuote(text: string, most = WHOLE_QUOTE_CHARS): string {
  const words = quoteWords(text)
  if (words.length <= most) return words
  const cut = words.slice(0, most)
  const space = cut.lastIndexOf(' ')
  return `${(space > most / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, '')}…`
}

/** The same place of the same message: answered twice, it is one place. */
export const samePlace = (a: ChatReplyTo, b: ChatReplyTo) =>
  a.messageId === b.messageId && a.start === b.start && quoteWords(a.quote) === quoteWords(b.quote)

const toBase64Url = (value: string) => {
  let binary = ''
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string) => {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

/**
 * A place as a token for the composer's text. Its payload is plain letters and digits, so the
 * note editor reads nothing into it; the field draws the token as a card.
 */
export function replyToken(to: ChatReplyTo): string {
  const data = [to.messageId, quoteWords(to.quote), ...(to.start !== undefined ? [to.start] : [])]
  return `${REPLY_OPEN}${toBase64Url(JSON.stringify(data))}${REPLY_CLOSE}`
}

function readToken(payload: string): ChatReplyTo | null {
  try {
    const data = JSON.parse(fromBase64Url(payload)) as unknown
    if (!Array.isArray(data)) return null
    const [messageId, quote, start] = data as unknown[]
    if (typeof messageId !== 'string' || typeof quote !== 'string') return null
    return { messageId, quote, ...(typeof start === 'number' ? { start } : {}) }
  } catch {
    return null
  }
}

/** The tokens in a composer's text, where each stands, and the place it is. */
export function replyTokens(text: string): { from: number; to: number; reply: ChatReplyTo }[] {
  const found: { from: number; to: number; reply: ChatReplyTo }[] = []
  for (const match of text.matchAll(TOKEN)) {
    const reply = readToken(match[1])
    if (reply) found.push({ from: match.index, to: match.index + match[0].length, reply })
  }
  return found
}

/** Whether a composer's text has any token, readable or not. */
export const hasReplyToken = (text: string) => text.includes(REPLY_OPEN)

/**
 * The composer's text as it is sent: the person's words, and where each place stands in them.
 * A token that cannot be read is dropped with nothing left of it.
 */
export function splitComposerText(text: string): { text: string; replyTo: ChatReplyTo[] } {
  const replyTo: ChatReplyTo[] = []
  let words = ''
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    words += text.slice(last, match.index)
    last = match.index + match[0].length
    const reply = readToken(match[1])
    if (reply) replyTo.push({ ...reply, at: words.length })
  }
  words += text.slice(last)
  return { text: words.replace(/[]/g, ''), replyTo }
}

/** A sent question back into the composer, its places where they stood: edited, or restored. */
export function composerText(content: string, replyTo?: readonly ChatReplyTo[]): string {
  if (!replyTo?.length) return content
  let text = ''
  let last = 0
  for (const to of placed(content, replyTo)) {
    text += content.slice(last, to.at) + replyToken(to)
    last = to.at
  }
  return text + content.slice(last)
}

/**
 * The places of a question in the order they stand, each with its `at` inside the text. One kept
 * from before places stood in the text has none, and stands at its start.
 */
export function placed(
  content: string,
  replyTo: readonly ChatReplyTo[]
): (ChatReplyTo & { at: number })[] {
  return replyTo
    .map((to, i) => ({ to: { ...to, at: Math.max(0, Math.min(to.at ?? 0, content.length)) }, i }))
    .sort((a, b) => a.to.at - b.to.at || a.i - b.i)
    .map(({ to }) => to)
}

/** The places of a question, numbered as the person and the agent see them: the same place, one number. */
export function replyNumbers(replyTo: readonly ChatReplyTo[]): number[] {
  const seen: ChatReplyTo[] = []
  return replyTo.map((to) => {
    const i = seen.findIndex((s) => samePlace(s, to))
    if (i >= 0) return i + 1
    seen.push(to)
    return seen.length
  })
}

/** At most `most` opening words of a place, to know it by. */
export function openingWords(quote: string, most = OPENING_WORDS): string {
  const words = quoteWords(quote).replace(/…$/, '').split(' ').filter(Boolean)
  return words.length > most ? `${words.slice(0, most).join(' ')}…` : words.join(' ')
}

const LINKS_OPEN = '<reply-links>'
const LINKS_CLOSE = '</reply-links>'
const marker = (n: number) => `[reply ${n}]`

/**
 * What the agent is given for a question with places: a block of links over the person's text,
 * then the text with a marker where each place stands. A link says which message, which words
 * (where they start and end in that message's text, or the whole of it) and its opening words.
 */
export function agentReplyText(content: string, replyTo?: readonly ChatReplyTo[]): string {
  if (!replyTo?.length) return content
  const order = placed(content, replyTo)
  const numbers = replyNumbers(order)
  const lines: string[] = []
  order.forEach((to, i) => {
    if (numbers.indexOf(numbers[i]) !== i) return
    const words =
      to.start !== undefined
        ? `characters ${to.start}-${to.start + to.quote.length}`
        : 'the whole message'
    lines.push(
      `${marker(numbers[i])} message ${to.messageId}, ${words}, begins: ${openingWords(to.quote)}`
    )
  })
  let text = ''
  let last = 0
  order.forEach((to, i) => {
    const before = content.slice(last, to.at)
    const after = content.slice(to.at)
    const gapBefore = before && !/\s$/.test(before) ? ' ' : ''
    const gapAfter = after && !/^\s/.test(after) ? ' ' : ''
    text += before + gapBefore + marker(numbers[i]) + gapAfter
    last = to.at
  })
  text += content.slice(last)
  const intro =
    'The person replies to places in earlier messages of this chat. Each link names the message, the words in it and how they begin; [reply N] in the text stands where that link was put.'
  return `${LINKS_OPEN}\n${intro}\n${lines.join('\n')}\n${LINKS_CLOSE}\n\n${text}`
}

const LINK_LINE =
  /^\[reply (\d+)\] message (\S+), (?:characters (\d+)-(\d+)|the whole message), begins: (.*)$/

/**
 * A question read back from what the agent was given — a node keeps only that — as the person's
 * words and its places. Null for text that does not open with the block of links.
 */
export function readAgentReplyText(
  text: string
): { content: string; replyTo: ChatReplyTo[] } | null {
  if (!text.startsWith(`${LINKS_OPEN}\n`)) return null
  const close = text.indexOf(`\n${LINKS_CLOSE}`)
  if (close < 0) return null
  const links = new Map<number, ChatReplyTo>()
  for (const line of text.slice(LINKS_OPEN.length + 1, close).split('\n')) {
    const m = LINK_LINE.exec(line)
    if (!m) continue
    const quote = m[5].replace(/…$/, '')
    links.set(Number(m[1]), {
      messageId: m[2],
      quote,
      ...(m[3] !== undefined ? { start: Number(m[3]) } : {}),
    })
  }
  if (!links.size) return null
  const body = text.slice(close + LINKS_CLOSE.length + 1).replace(/^\n\n?/, '')
  const replyTo: ChatReplyTo[] = []
  let content = ''
  let last = 0
  for (const m of body.matchAll(/ ?\[reply (\d+)\] ?/g)) {
    const link = links.get(Number(m[1]))
    if (!link) continue
    content += body.slice(last, m.index)
    last = m.index + m[0].length
    // The gaps were the marker's own; a word on each side keeps one between them.
    const before = m[0].startsWith(' ')
    const after = m[0].endsWith(' ')
    if (before && after && content && last < body.length) content += ' '
    replyTo.push({ ...link, at: content.length })
  }
  content += body.slice(last)
  return { content, replyTo }
}

/**
 * A plain text box cannot draw a chip: there a place stands in the text as a readable marker of
 * its number, and the places themselves are kept beside the text by their numbers.
 */
export const replyMarker = (n: number) => `[↩${n}]`
const MARKER = /\[↩(\d+)\]/g

/** A plain text box's text as it is sent: the words, and where each place's marker stood. */
export function splitMarkedText(
  text: string,
  places: ReadonlyMap<number, ChatReplyTo>
): { text: string; replyTo: ChatReplyTo[] } {
  const replyTo: ChatReplyTo[] = []
  let words = ''
  let last = 0
  for (const match of text.matchAll(MARKER)) {
    const place = places.get(Number(match[1]))
    if (!place) continue
    words += text.slice(last, match.index)
    last = match.index + match[0].length
    replyTo.push({ ...place, at: words.length })
  }
  return { text: words + text.slice(last), replyTo }
}
