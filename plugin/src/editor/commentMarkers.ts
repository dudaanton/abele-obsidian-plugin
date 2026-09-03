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

/**
 * Backtick runs on one line: a run of n backticks opens a span and the next run of exactly n
 * closes it. Enough for the question being asked — is this text code — without a parser.
 */
function inlineCodeRegions(line: string, base: number): Region[] {
  const regions: Region[] = []
  const runs = [...line.matchAll(/`+/g)]

  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[j][0].length !== open[0].length) continue
      regions.push({
        from: base + (open.index ?? 0),
        to: base + (runs[j].index ?? 0) + runs[j][0].length,
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
