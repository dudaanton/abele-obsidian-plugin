import { CommentMarkerWidget } from '@/editor/CommentMarkerWidget'
import type { CommentState } from '@/editor/CommentPlugin'
import { parseChat } from './ChatLog'
import { getPathToLeaf } from './chatTree'
import { conversationLines, firstQuestion, renderLines } from './chatText'
import type { ChatMessage, CommentAnchor } from './types'

/**
 * Comments asked about a passage of an agent's answer, inside a chat.
 *
 * A note carries its comments as markers in its own text. An answer cannot: it is what the
 * model wrote, and it is drawn from markdown every time it comes on screen. So the anchor is a
 * quote plus where that quote starts in the text the reader sees — the rendered answer's text,
 * not its markdown — and it is kept in the chat's own metadata (`ChatMetadata.comments`). On
 * each draw the quote is looked for at that offset first and at the nearest other place second,
 * which is what keeps a passage found when the answer is drawn anew.
 */

/** Everything drawn here carries this, so drawing again starts from the answer as rendered. */
const PAINTED = 'data-abele-painted'

/** One comment as a message draws it: where it is, and what its icon says. */
export interface PaintedComment {
  id: string
  quote?: string
  start?: number
  /** Messages in the comment's chat — the digit on its icon, as in a note. */
  count: number
  state: CommentState
  open: boolean
}

/** The icons carry a digit; text inside them is not part of the answer. */
function isOurs(node: Node): boolean {
  const parent = node.parentElement
  return !!parent?.closest('.abele-comment-marker')
}

/** The answer's text nodes in order, with where each starts in the text the reader sees. */
function textNodes(root: HTMLElement): Array<{ node: Text; start: number }> {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Array<{ node: Text; start: number }> = []
  let at = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isOurs(node)) continue
    nodes.push({ node: node as Text, start: at })
    at += node.textContent?.length ?? 0
  }
  return nodes
}

function textOf(nodes: Array<{ node: Text }>): string {
  return nodes.map(({ node }) => node.textContent ?? '').join('')
}

/** Where a range boundary falls in the answer's text. */
function offsetOf(
  nodes: Array<{ node: Text; start: number }>,
  container: Node,
  offset: number
): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const own = nodes.find(({ node }) => node === container)
    if (own) return own.start + offset
  }

  const ref = container.nodeType === Node.TEXT_NODE ? container : container.childNodes[offset]
  let total = 0
  for (const { node } of nodes) {
    const before = ref
      ? !!(node.compareDocumentPosition(ref) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !(ref.nodeType !== Node.TEXT_NODE && ref.contains(node))
      : container.contains(node) ||
        !!(node.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING)
    if (!before) break
    total += node.textContent?.length ?? 0
  }
  return total
}

/**
 * What a selection in a rendered answer anchors to: its words, trimmed, and where they start.
 * Nothing when it reaches outside the answer or holds nothing but space.
 */
export function selectionAnchor(
  root: HTMLElement,
  range: Range
): { quote: string; start: number } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null

  const nodes = textNodes(root)
  const text = textOf(nodes)
  const from = offsetOf(nodes, range.startContainer, range.startOffset)
  const to = offsetOf(nodes, range.endContainer, range.endOffset)
  const raw = text.slice(from, to)
  const quote = raw.trim()
  if (!quote) return null

  return { quote, start: from + (raw.length - raw.trimStart().length) }
}

/** The quote at `start` if it is still there, else its nearest occurrence, else nothing. */
export function locateQuote(
  text: string,
  quote: string,
  start = 0
): { from: number; to: number } | null {
  if (!quote) return null
  if (text.startsWith(quote, start)) return { from: start, to: start + quote.length }

  let best = -1
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    if (best === -1 || Math.abs(at - start) < Math.abs(best - start)) best = at
  }
  return best === -1 ? null : { from: best, to: best + quote.length }
}

/** Takes back everything a previous draw added, leaving the answer as it was rendered. */
function unpaint(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll(`.abele-comment-marker[${PAINTED}]`))) {
    el.remove()
  }
  for (const el of Array.from(root.querySelectorAll(`.abele-comment__quote[${PAINTED}]`))) {
    el.replaceWith(...Array.from(el.childNodes))
  }
  root.normalize()
}

/** Wraps `[from, to)` of the answer's text, node by node. Returns the last wrapper. */
function wrap(root: HTMLElement, from: number, to: number, cls: string): HTMLElement | null {
  let last: HTMLElement | null = null
  for (const { node, start } of textNodes(root)) {
    const length = node.textContent?.length ?? 0
    const a = Math.max(from, start) - start
    const b = Math.min(to, start + length) - start
    if (a >= b) continue

    let piece = node
    if (a > 0) piece = piece.splitText(a)
    if (b - a < (piece.textContent?.length ?? 0)) piece.splitText(b - a)

    const span = root.ownerDocument.win.createSpan()
    span.className = cls
    span.setAttribute(PAINTED, '')
    piece.replaceWith(span)
    span.appendChild(piece)
    last = span
  }
  return last
}

/** Inline elements an icon at the end of an answer is not put inside — a link above all. */
const INLINE = new Set(['A', 'CODE', 'STRONG', 'EM', 'B', 'I', 'SPAN', 'MARK', 'DEL', 'S', 'U'])

/** The block the answer's last words are in, where an icon for the whole answer goes. */
function endOf(root: HTMLElement): HTMLElement {
  const nodes = textNodes(root).filter(({ node }) => node.textContent?.trim())
  let el = nodes.length ? nodes[nodes.length - 1].node.parentElement : null
  while (el && el !== root && INLINE.has(el.tagName)) el = el.parentElement
  return el && root.contains(el) ? el : root
}

/**
 * Draws a message's comments over its rendered answer: the passage marked the way a note marks
 * it, and the note's own icon right after it — the same classes, so the same look.
 *
 * A comment on the whole answer has its icon at the answer's end. So does one whose words can
 * no longer be found, dimmed, so it can still be opened and deleted rather than vanish.
 * Idempotent: a second call replaces the first rather than adding to it.
 */
export function paintMessageComments(
  root: HTMLElement,
  comments: PaintedComment[],
  onOpen: (id: string) => void
): void {
  unpaint(root)

  for (const comment of comments) {
    const text = textOf(textNodes(root))
    const found = comment.quote ? locateQuote(text, comment.quote, comment.start) : null

    let after: HTMLElement | null = null
    if (found && found.from < found.to) {
      const cls =
        'abele-comment__quote' +
        (comment.open ? ' abele-comment__quote_open' : '') +
        (comment.state === 'busy' ? ' abele-comment__quote_busy' : '')
      after = wrap(root, found.from, found.to, cls)
    }

    const icon = new CommentMarkerWidget(
      [comment.id],
      comment.count,
      comment.state,
      comment.open,
      (ids) => onOpen(ids[0])
    ).toDOM()
    icon.setAttribute(PAINTED, '')
    if (comment.quote && !found) icon.classList.add('abele-comment-marker_orphan')

    if (after) after.after(icon)
    else endOf(root).appendChild(icon)
  }
}

/** Above this the conversation before the answer keeps its end — the part closest to it. */
const CONVERSATION_LIMIT = 12_000

/** The answer's own text, as the chat's other readers are given it. */
const ANSWER_LIMIT = 12_000

/**
 * The "Where you are" block for a comment on an answer in a chat.
 *
 * Built by the same rule as a chat attached to a message: only what the person and the agent
 * wrote (`conversationLines`) — no tool calls, results, reasoning or drafts — and only the
 * branch that leads to the answer, up to it. What came after the answer is not what the
 * question is about. `chatContent` is null when the chat has been deleted.
 */
export function buildMessageCommentContext(
  anchor: CommentAnchor,
  chatContent: string | null,
  lineage: string[] = []
): string {
  const lines = ['## Where you are']
  const parsed = chatContent === null ? null : parseChat(chatContent)
  const name =
    anchor.note
      .split('/')
      .pop()
      ?.replace(/\.abchat$/, '') ?? anchor.note

  if (!parsed || parsed.metadata?.type !== 'abele-chat') {
    lines.push(`Chat: ${name} — it has been deleted since this comment was made.`)
    if (anchor.quote) lines.push('Selected text:', anchor.quote)
    return lines.join('\n')
  }

  // A comment on a comment: the conversation it is in is a side discussion itself, named by the
  // question that opened it — its title, when it has one, is a date and that question.
  const nested = parsed.metadata.kind === 'comment'
  const title = nested ? firstQuestion(parsed.messages) || name : parsed.metadata.title || name
  lines.push(
    `${nested ? 'Side discussion' : 'Chat'}: ${title} (${anchor.note})`,
    'This comment is about a passage in one of the messages in that ' +
      (nested ? 'side discussion' : 'chat') +
      '. Only what the person and the agent wrote there is included; its tool calls, their ' +
      'results and its reasoning are not.'
  )
  if (lineage.length) {
    lines.push(
      'That side discussion was itself started from a passage of another conversation. The ' +
        'chain above it, nearest first — only the words asked about and where, not what was ' +
        'said there:',
      ...lineage
    )
  }
  if (anchor.quote) lines.push('Selected text:', anchor.quote)

  const messages: ChatMessage[] = parsed.messages
  const target = messages.find((message) => message.id === anchor.message)
  if (!target) {
    lines.push('The answer it was asked about is no longer in that chat.')
    return lines.join('\n')
  }

  const hasTree = messages.some((message) => message.parentId)
  const path = hasTree
    ? getPathToLeaf(messages, target.id)
    : messages.slice(0, messages.indexOf(target) + 1)
  const said = conversationLines(path)
  const answer = conversationLines([target])[0]?.text ?? ''
  const before = answer ? said.slice(0, -1) : said

  if (answer) {
    const cut = answer.length > ANSWER_LIMIT ? `${answer.slice(0, ANSWER_LIMIT)}…` : answer
    const who = target.role === 'user' ? 'the person' : 'the agent'
    lines.push(`The message it is in, written by ${who}:`, cut)
  }

  const blocks = before.map((line) => renderLines([line]))
  let size = 0
  let from = blocks.length
  while (from > 0 && size + blocks[from - 1].length <= CONVERSATION_LIMIT) {
    size += blocks[from - 1].length + 2
    from--
  }
  if (from < blocks.length) {
    lines.push(
      'The conversation before it:',
      (from > 0 ? '[... earlier messages omitted]\n\n' : '') + blocks.slice(from).join('\n\n')
    )
  }

  return lines.join('\n')
}
