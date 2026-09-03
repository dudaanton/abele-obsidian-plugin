/**
 * The comment marker syntax: `%%c:k7d2ph%%`, one or more six-character ids.
 *
 * Everything here is a pure function over the note's text. The editor extension, the service
 * that writes the file and the command that starts a comment all share these, so that the one
 * definition of "where the marker is" cannot drift between them.
 *
 * Obsidian's own `%% %%` comment syntax was chosen so that reading mode, mobile without the
 * plugin and every other Markdown application hide the marker on their own; the plugin never
 * relies on that in live preview, where it draws an icon over it instead.
 */
import { customAlphabet } from 'nanoid'

export const COMMENT_ID_RE = /^[a-z0-9]{6}$/
export const COMMENT_MARKER_RE = /%%c:([a-z0-9]{6}(?:,[a-z0-9]{6})*)%%/g

/** Lowercase alphanumerics only: the marker sits in prose and must survive a case-folding sync. */
const nextId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6)

export function newCommentId(): string {
  return nextId()
}

export interface ParsedMarker {
  from: number
  to: number
  ids: string[]
}

type RegionKind = 'frontmatter' | 'fence' | 'inline'

interface Region {
  from: number
  to: number
  kind: RegionKind
}

/** A run of backticks that is allowed to open or close a span, after the escape is taken off. */
interface BacktickRun {
  index: number
  length: number
}

/**
 * The backtick runs of one line, with `\\`` read as the literal backtick it is.
 *
 * A backslash escapes only the backtick immediately after it, so an escaped run of one is gone
 * altogether and a longer one is a run one shorter starting a character later. The backslash
 * itself can be escaped — `\\\\` then a backtick is a backslash and a span — which is why the
 * count of backslashes is taken and its parity, not just the character before.
 */
function backtickRuns(line: string): BacktickRun[] {
  const runs: BacktickRun[] = []

  for (const run of line.matchAll(/`+/g)) {
    const index = run.index ?? 0
    let backslashes = 0
    while (index - backslashes - 1 >= 0 && line[index - backslashes - 1] === '\\') backslashes++

    const escaped = backslashes % 2 === 1
    const length = escaped ? run[0].length - 1 : run[0].length
    if (length > 0) runs.push({ index: escaped ? index + 1 : index, length })
  }

  return runs
}

/**
 * Backtick runs on one line: a run of n backticks opens a span and the next run of exactly n
 * closes it. Enough for the question being asked — is this text code — without a parser.
 */
function inlineCodeRegions(line: string, base: number): Region[] {
  const regions: Region[] = []
  const runs = backtickRuns(line)

  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[j].length !== open.length) continue
      regions.push({
        from: base + open.index,
        to: base + runs[j].index + runs[j].length,
        kind: 'inline',
      })
      i = j
      break
    }
  }

  return regions
}

/** Frontmatter, fenced code and inline code — the places a marker is neither read nor written. */
function excludedRegions(text: string): Region[] {
  const regions: Region[] = []
  const lines = text.split('\n')

  const lineFrom: number[] = []
  let offset = 0
  for (const line of lines) {
    lineFrom.push(offset)
    offset += line.length + 1
  }

  let i = 0

  // Frontmatter only counts when the very first line opens it.
  if (lines[0] === '---') {
    for (let j = 1; j < lines.length; j++) {
      if (lines[j] === '---' || lines[j] === '...') {
        regions.push({ from: 0, to: lineFrom[j] + lines[j].length, kind: 'frontmatter' })
        i = j + 1
        break
      }
    }
  }

  let fence: { marker: string; from: number } | null = null

  for (; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)

    if (fence) {
      const closes =
        fenceMatch &&
        fenceMatch[1][0] === fence.marker[0] &&
        fenceMatch[1].length >= fence.marker.length
      if (closes) {
        regions.push({ from: fence.from, to: lineFrom[i] + line.length, kind: 'fence' })
        fence = null
      }
      continue
    }

    if (fenceMatch) {
      fence = { marker: fenceMatch[1], from: lineFrom[i] }
      continue
    }

    regions.push(...inlineCodeRegions(line, lineFrom[i]))
  }

  // A fence nobody closed runs to the end of the document, which is how the editor renders it.
  if (fence) regions.push({ from: fence.from, to: text.length, kind: 'fence' })

  return regions
}

/** All markers outside fenced code, inline code and frontmatter. */
export function parseMarkers(text: string): ParsedMarker[] {
  const regions = excludedRegions(text)
  const markers: ParsedMarker[] = []

  COMMENT_MARKER_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = COMMENT_MARKER_RE.exec(text)) !== null) {
    const from = match.index
    if (regions.some((region) => from >= region.from && from < region.to)) continue
    markers.push({ from, to: from + match[0].length, ids: match[1].split(',') })
  }

  return markers
}

/**
 * Where a new marker may be written.
 *
 * A fence and its frontmatter are refused inclusive of their own lines — a marker at the start
 * of the ``` line breaks the fence just as surely as one inside it. Inline code is refused
 * strictly inside, because commenting on `a value in backticks` is a normal thing to do and
 * the selection ends exactly at the closing backtick.
 *
 * A position inside an existing marker is *not* refused: nothing is written there, the id is
 * appended to the marker that is already sitting on that spot. See `insertMarker`.
 */
export function isCommentablePosition(text: string, pos: number): boolean {
  for (const region of excludedRegions(text)) {
    if (region.kind === 'inline') {
      if (pos > region.from && pos < region.to) return false
    } else if (pos >= region.from && pos <= region.to) {
      return false
    }
  }

  return true
}

/**
 * Constructs a marker must never be written into the middle of.
 *
 * Everything here is Markdown that a dozen characters dropped into it destroys, and every one
 * of them was watched doing it in live preview: `![[pic.p%%c:…%%ng]]` renders as the literal
 * text of a broken embed, `[[Bo%%c:…%%oks|the books]]` becomes a link to a note nobody has,
 * `Claim[^%%c:…%%1]` stops being a footnote and `> [!no%%c:…%%te]` stops being that callout.
 *
 * All of them are single-line by definition, so the search is over one line. A construct that
 * survives a marker — a heading, a blockquote, a list item's text, a table cell — is not here:
 * `%%…%%` is Obsidian's own comment syntax and reads as nothing wherever it is allowed to.
 */
/**
 * The head of a line that opens a callout: the blockquote it sits in, then its `[!type]`.
 *
 * One definition, used twice — by the hop below and by `onCalloutTitle` further down — so the
 * line a marker is carried out of and the line it is refused on cannot drift apart.
 *
 * Only a blockquote opens a callout. `[!note]` written mid-sentence is prose, and so, watched
 * in live preview on 2026-09-03, are `- > [!note]` and `> - > [!note]`: Obsidian draws neither
 * as a callout and leaves both as the literal text they are. A list marker is therefore not
 * part of this prefix — a position on one of those lines is ordinary text, with nothing to be
 * carried out of and nothing to refuse.
 */
const CALLOUT_HEAD = String.raw`^[ \t>]*>[ \t]*\[![^\]\n]+\]`

const INLINE_CONSTRUCTS = [
  /!?\[\[[^[\]\n]*\]\]/g, // wikilink and embed, alias, heading and block reference included
  /!?\[[^[\]\n]*\]\([^()\n]*\)/g, // markdown link and image
  /\[\^[^\]\s\n]+\]/g, // footnote reference
  // The type of a callout, with the fold marker and the space that have to follow it.
  new RegExp(String.raw`${CALLOUT_HEAD}[-+]?[ \t]*`, 'g'),
  /==[^\n]+?==/g, // highlight
]

/**
 * A task box, which is only one at the head of a list item.
 *
 * The trailing space belongs to the box, here and in the callout above: Obsidian reads
 * `- [ ] text`, and `- [ ]%%c:…%%text` is a bullet with brackets in it. Both were watched
 * failing that way in live preview, one marker to the left of where they now go.
 */
const CHECKBOX = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[^\]\n]\][ \t]*/

/** How many nestings deep the search goes: a link inside a highlight is two. */
const MAX_NESTING = 8

/** The end of the construct `pos` fell inside, if it fell inside one. */
function constructEnd(text: string, pos: number): number | undefined {
  const lineFrom = text.lastIndexOf('\n', pos - 1) + 1
  const newline = text.indexOf('\n', pos)
  const line = text.slice(lineFrom, newline === -1 ? text.length : newline)
  const at = pos - lineFrom

  const box = CHECKBOX.exec(line)
  if (box && at > 0 && at < box[0].length) return lineFrom + box[0].length

  for (const pattern of INLINE_CONSTRUCTS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(line)) !== null) {
      const end = match.index + match[0].length
      if (at > match.index && at < end) return lineFrom + end
    }
  }

  return undefined
}

/**
 * The position carried out of every construct it sits inside.
 *
 * Inline code is one of them, and the only one already known to `excludedRegions`. A single
 * hop is not always enough — a link inside a highlight leaves the marker between `]]` and the
 * closing `==`, which is still inside somebody's markup — so it repeats until nothing moves.
 */
function pastConstructs(text: string, pos: number): number {
  const code = excludedRegions(text).filter((region) => region.kind === 'inline')
  let at = pos

  for (let hop = 0; hop < MAX_NESTING; hop++) {
    const inCode = code.find((region) => at > region.from && at < region.to)
    const next = inCode ? inCode.to : constructEnd(text, at)
    if (next === undefined || next <= at) break
    at = next
  }

  return at
}

/** Pipes, dashes and colons and nothing else: the row that tells Obsidian these lines are a table. */
const TABLE_RULE = /^[ \t|:-]+$/

const isTableRule = (line: string): boolean =>
  TABLE_RULE.test(line) && line.includes('|') && line.includes('-')

/** A line shaped like part of a table: it opens with a pipe, or it is the row of dashes. */
const isTableLine = (line: string): boolean => /^[ \t]*\|/.test(line) || isTableRule(line)

/**
 * The type of a callout, at the head of the line that carries its title.
 *
 * `> [!note]`, `> [!tip]- Folded`, and the same nested inside another callout. The shape is
 * `CALLOUT_HEAD` above and nothing else: what counts as opening a callout is answered in one
 * place, whether the answer is a nudge or a refusal.
 */
const CALLOUT_TITLE = new RegExp(CALLOUT_HEAD)

/** The line `pos` sits on, and where in the text it starts and ends. */
function lineAt(text: string, pos: number): { from: number; to: number; line: string } {
  const from = text.lastIndexOf('\n', pos - 1) + 1
  const newline = text.indexOf('\n', pos)
  const to = newline === -1 ? text.length : newline
  return { from, to, line: text.slice(from, to) }
}

/**
 * Whether `pos` is anywhere on a table.
 *
 * A table is drawn by a widget of Obsidian's own, and the widget draws the cells rather than
 * the text of the line: a marker written into a cell is swallowed by it — no icon, nothing to
 * press, and a comment that cannot be reached again. The row of dashes is worse still, since
 * it is the whole of what makes those lines a table and a marker on it leaves the block
 * rendering as raw pipes. Nowhere on any of those lines is there an end to move past, so the
 * whole block is a refusal rather than a nudge.
 *
 * A block of table-shaped lines is only a table when a row of dashes says so; without one
 * they are lines that happen to start with a pipe, and Obsidian renders them as prose.
 */
function onTableRow(text: string, pos: number): boolean {
  const here = lineAt(text, pos)
  if (pos > here.to || !isTableLine(here.line)) return false

  const lines = text.split('\n')
  const index = text.slice(0, here.from).split('\n').length - 1

  for (let i = index; i >= 0 && isTableLine(lines[i]); i--) if (isTableRule(lines[i])) return true
  for (let i = index; i < lines.length && isTableLine(lines[i]); i++) {
    if (isTableRule(lines[i])) return true
  }

  return false
}

/**
 * Whether `pos` is on the line that names a callout.
 *
 * That line is not shown: Obsidian renders it as the callout's header — an icon, the title,
 * and a fold arrow — and a marker left on it is drawn nowhere at all. The body is ordinary
 * text inside a blockquote and keeps its marker, which is why this asks about the one line
 * rather than the block.
 */
function onCalloutTitle(text: string, pos: number): boolean {
  const here = lineAt(text, pos)
  if (pos > here.to) return false

  return CALLOUT_TITLE.test(here.line)
}

/** Where a comment's marker goes, and how far its quote reaches. `null` when there is nowhere. */
export interface CommentAnchorPoint {
  pos: number
  quoteTo: number
}

/**
 * Where a comment made over a selection ending at `pos` should be anchored.
 *
 * The marker goes at the end of the selection, and a finger — or a double-click — puts that end
 * wherever it lands, which is often the middle of a link, an embed or a footnote. So the
 * position is first carried out to the end of whatever construct it is inside, and the quote
 * is carried with it: the passage the reader chose plus the rest of the thing they stopped
 * halfway through, which is what keeps the underline over something recognisable.
 *
 * `null` is the refusal, and there are four of them: a fence, where the marker would render as
 * text; frontmatter, where it breaks the YAML; a table, whose widget swallows the marker in a
 * cell and whose row of dashes the marker breaks; and a callout's title line, which is drawn
 * as a header the marker disappears into. None of the four has an end worth moving to.
 */
export function anchorFor(text: string, pos: number): CommentAnchorPoint | null {
  const at = pastConstructs(text, pos)

  // Checked after the hop rather than before: `isCommentablePosition` also refuses the inside
  // of inline code, which is a place the hop has just carried the position out of.
  if (!isCommentablePosition(text, at)) return null
  if (onTableRow(text, at) || onCalloutTitle(text, at)) return null

  return { pos: at, quoteTo: at }
}

export function markerText(ids: string[]): string {
  return `%%c:${ids.join(',')}%%`
}

/** Whitespace without a line break: the width of the gap a merge is allowed to cross. */
const SAME_LINE_GAP = /^[^\S\n]*$/

/**
 * The marker a comment made over `from`–`pos` should join, if there is one.
 *
 * On a desktop the second comment on a passage ends exactly where the first one's marker
 * begins, and that was the whole rule. A phone does not aim that well: the widget is atomic,
 * so a selection dragged as far as the icon ends on the marker's far side or somewhere inside
 * it, and a comment placed a moment later lands after the marker rather than on it. Each of
 * those is the same act, and refusing to merge them is what put two icons side by side, one
 * comment on each and no count on either.
 *
 * So three ways in, all of them meaning "this passage": the position sits anywhere from the
 * marker's start to its end; whitespace on the same line is all that separates a marker from
 * a position after it; or the selection swallowed the marker whole. A line break is where it
 * stops — a marker at the end of the paragraph above is about another passage, whatever the
 * distance.
 *
 * A position *before* a marker is not one of them. On a phone the gap is the widget's own
 * width and merging across it was a fair guess; on a desktop a caret set down at the end of
 * the previous sentence is somebody starting a distinct comment, and joining it to the marker
 * beyond the space took their comment away from them.
 */
function mergeTarget(text: string, from: number, pos: number): ParsedMarker | undefined {
  let best: ParsedMarker | undefined
  let bestDistance = Infinity

  for (const marker of parseMarkers(text)) {
    const inside = pos >= marker.from && pos <= marker.to
    const swallowed = marker.from >= from && marker.to <= pos
    const after = marker.to <= pos && SAME_LINE_GAP.test(text.slice(marker.to, pos))
    if (!inside && !swallowed && !after) continue

    const distance = inside ? 0 : Math.min(Math.abs(pos - marker.to), Math.abs(marker.from - pos))
    if (distance < bestDistance) {
      bestDistance = distance
      best = marker
    }
  }

  return best
}

/**
 * Returns the new text and the marker written or extended.
 *
 * A second comment on the same passage appends its id to the marker already sitting there
 * rather than writing another beside it. `from` is where the selection started — a caret has
 * none, so it defaults to the position itself; see `mergeTarget` for what counts as the same
 * passage.
 */
export function insertMarker(
  text: string,
  pos: number,
  id: string,
  from: number = pos
): { text: string; marker: ParsedMarker } {
  const existing = mergeTarget(text, from, pos)

  if (existing) {
    const ids = [...existing.ids, id]
    const written = markerText(ids)
    return {
      text: text.slice(0, existing.from) + written + text.slice(existing.to),
      marker: { from: existing.from, to: existing.from + written.length, ids },
    }
  }

  const written = markerText([id])
  return {
    text: text.slice(0, pos) + written + text.slice(pos),
    marker: { from: pos, to: pos + written.length, ids: [id] },
  }
}

/** Removes one id; removes the whole marker when it was the last. */
export function removeMarkerId(text: string, id: string): string {
  const marker = parseMarkers(text).find((candidate) => candidate.ids.includes(id))
  if (!marker) return text

  const rest = marker.ids.filter((candidate) => candidate !== id)
  const written = rest.length > 0 ? markerText(rest) : ''

  return text.slice(0, marker.from) + written + text.slice(marker.to)
}

/**
 * The note as the agent should read it. Routed through `parseMarkers` rather than the raw
 * regex, so that a fenced example of the syntax — someone's notes *about* comment markers —
 * survives being sent to a model and, more to the point, survives being written back.
 */
export function stripMarkers(text: string): string {
  const markers = parseMarkers(text)
  if (markers.length === 0) return text

  let stripped = ''
  let at = 0
  for (const marker of markers) {
    stripped += text.slice(at, marker.from)
    at = marker.to
  }

  return stripped + text.slice(at)
}

export type ResolvedRange = { from: number; to: number } | null

/**
 * Spec section 1: the marker is the only thing in the note, and the quoted text lives in the
 * chat file. Three rules, in order — the text ending at the marker, the nearest occurrence
 * anywhere in the document, or nothing, in which case the comment is point-anchored.
 *
 * "Nearest" is measured between the marker and the closer edge of the occurrence, so that a
 * passage moved a paragraph up is preferred over an unrelated repetition further down.
 */
export function resolveQuote(
  text: string,
  marker: ParsedMarker,
  quote: string | undefined
): ResolvedRange {
  if (!quote) return null

  const before = marker.from - quote.length
  if (before >= 0 && text.slice(before, marker.from) === quote) {
    return { from: before, to: marker.from }
  }

  let best: ResolvedRange = null
  let bestDistance = Infinity

  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    const to = at + quote.length
    const distance = to <= marker.from ? marker.from - to : Math.max(0, at - marker.to)
    if (distance < bestDistance) {
      bestDistance = distance
      best = { from: at, to }
    }
  }

  return best
}
