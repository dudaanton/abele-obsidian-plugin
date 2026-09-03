import { parseMarkers, resolveQuote, stripMarkers } from '@/editor/commentMarkers'
import type { CommentAnchor } from './types'

/**
 * Above this the note is not sent. The comment agent has `read`, and a note this size costs
 * more of the window than the answer is worth — the passage and its paragraph are the point.
 */
export const COMMENT_WHOLE_NOTE_LIMIT = 12_000

/**
 * Where in the note this comment's marker sits.
 *
 * The anchor holds no position — that is deliberate, the marker in the text is the position —
 * so it is found back through the id, then through the quote. A cursor comment whose id is not
 * known is located only when its marker is the note's one marker; otherwise there is no honest
 * answer and the paragraph is left out rather than guessed at.
 */
function anchorPosition(
  noteText: string,
  anchor: CommentAnchor,
  commentId?: string
): number | null {
  const markers = parseMarkers(noteText)
  if (!markers.length) return null

  if (commentId) {
    const own = markers.find((marker) => marker.ids.includes(commentId))
    if (own) return own.from
  }

  for (const marker of markers) {
    if (resolveQuote(noteText, marker, anchor.quote)) return marker.from
  }

  return markers.length === 1 ? markers[0].from : null
}

/** The text between the nearest blank lines either side of `pos`. */
function paragraphAround(noteText: string, pos: number): string {
  const before = noteText.lastIndexOf('\n\n', pos)
  const start = before === -1 ? 0 : before + 2
  const after = noteText.indexOf('\n\n', pos)
  const end = after === -1 ? noteText.length : after

  return stripMarkers(noteText.slice(start, end)).trim()
}

/**
 * The "Where you are" block, spec §3.
 *
 * `noteText` is the note's body as it is right now — the caller reads it every turn, so an
 * edit made since the last answer is in front of the model rather than remembered wrongly.
 * `commentId` is how a cursor comment, which has no quote to match on, finds its own marker
 * among several.
 */
export function buildCommentContext(
  anchor: CommentAnchor,
  noteText: string,
  commentId?: string
): string {
  const lines = ['## Where you are', `Note: ${anchor.note}`]

  if (anchor.quote) lines.push('Selected text:', anchor.quote)

  const pos = anchorPosition(noteText, anchor, commentId)
  if (pos !== null) {
    const paragraph = paragraphAround(noteText, pos)
    if (paragraph) lines.push('Around it:', paragraph)
  }

  const body = stripMarkers(noteText).trim()
  lines.push(
    body.length < COMMENT_WHOLE_NOTE_LIMIT
      ? `Whole note:\n${body}`
      : 'Whole note: too long to include here — use read for the rest.'
  )

  return lines.join('\n')
}
