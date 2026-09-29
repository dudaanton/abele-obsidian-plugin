/**
 * A book's highlights, kept in an ordinary note beside it, one callout per highlight:
 *
 * ```markdown
 * ---
 * type: book-highlights
 * file: "[[Books/Dune.epub]]"
 * ---
 *
 * > [!quote|yellow] [[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]]
 * > Fear is the mind-killer.
 * >
 * > My note on it.
 * ```
 *
 * A discussion — a chat with the AI about the words, made with "Ask here" — is a highlight too,
 * its chat linked after the place in the title. Words only asked about, never highlighted, are a
 * `chat` callout, with no colour; a highlight that was asked about keeps its `quote|colour`:
 *
 * ```markdown
 * > [!chat] [[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]] · [[AI/Comments/k7d2ph.abchat|Discussion]]
 * > Fear is the mind-killer.
 * ```
 *
 * The callout's title is a link to the place; its first paragraph is the highlighted text; what
 * follows a blank line inside it is the person's comment. The colour is the callout's metadata,
 * which Obsidian draws as an ordinary quote. Highlights are kept in the book's order. Anything else
 * in the note — a heading, the person's own paragraphs between callouts — is left where it is.
 *
 * A note made from a template whose body gives the comment a field of its own keeps the comment
 * there instead, outside the callout; it is read and written there while what is around the
 * callout still reads as the body wrote it (`entryComment.ts`), and inside the callout otherwise.
 *
 * A highlight may also name forms of its word to underline everywhere in the book (`vocab/`): in
 * the template's `{{ forms }}` field, the same way, or else as the callout's last line:
 *
 * ```markdown
 * > [!quote|yellow] [[Books/Novel.epub#cfi=/6/8!/4/2,/1:0,/1:4|Chapter 3]]
 * > māja
 * >
 * > forms:: māja, mājas, mājā
 * ```
 *
 * Everything here works on the note's text, so the rules are tested without a vault.
 */
import { encodeCfi, parsePlaceSubpath, type BookPlace } from './bookLinks'
import {
  commentLines,
  formsLineOf,
  formsOnLine,
  isBlankField,
  matchEntry,
  withForms,
  type EntryFrame,
  type EntryMatch,
} from './entryComment'
import { formsLine, parseForms } from './vocab/words'

export type { EntryFrame } from './entryComment'

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export interface Highlight {
  /** Where it is: a CFI for a book or a PDF page's text, the key that tells highlights apart. */
  cfi: string
  color: HighlightColor
  /** The highlighted text, as it was when it was made. */
  text: string
  comment: string
  /** The chapter or page it is in, written as the link's label. */
  label: string
  /** The id of the discussion held about these words: its chat is the comment of that id. */
  discussion?: string
  /** Asked about, never highlighted: drawn as a discussion only, with no colour of its own. */
  plain?: boolean
  /** Forms of its word underlined everywhere in the book (`vocab/rules.ts`); none when unset. */
  forms?: string[]
}

export const HIGHLIGHTS_TYPE = 'book-highlights'

/**
 * The property a highlights note links back to its book in: a File property, drawn as the book's
 * card. Notes written before it used `book`, which is still read (`BOOK_LINK_KEYS`) and never
 * rewritten.
 */
export const BOOK_LINK_KEY = 'file'
export const BOOK_LINK_KEYS = [BOOK_LINK_KEY, 'book'] as const

const HEADER = /^\uFEFF?>\s*\[!(quote|chat)(?:\|([a-z]+))?\][+-]?\s*(.*)$/i
/** A link to a chat file in a callout title, its basename being the discussion's id. */
const CHAT_LINK =
  /\[\[([^\]|]+?\.abchat)(?:\|[^\]]*)?\]\]|\[[^\]]*\]\(\s*<?([^)>\s]+\.abchat)>?\s*\)/i
/** The link in a callout title: a wikilink or a markdown link, its target and label. */
const WIKI = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/
const MD = /\[([^\]]*)\]\(\s*<?([^)>\s]+)>?\s*\)/

/** The callout line holding a highlight's forms, when the template has no field for them. */
const FORMS_LINE = /^forms::[ \t]*(.*)$/i

const colorOf = (value: string | undefined): HighlightColor =>
  (HIGHLIGHT_COLORS as readonly string[]).includes((value ?? '').toLowerCase())
    ? ((value ?? '').toLowerCase() as HighlightColor)
    : 'yellow'

/** The discussion a callout title links to, by its chat file's name. */
function discussionIn(title: string): string | undefined {
  const m = CHAT_LINK.exec(title)
  const path = m?.[1] ?? m?.[2]
  return path
    ? path
        .split('/')
        .pop()
        ?.replace(/\.abchat$/i, '')
    : undefined
}

/**
 * The place a callout title links to, its label, and the file the link names, as written; null when
 * the title is no place.
 */
function placeIn(title: string): { place: BookPlace; label: string; target: string } | null {
  const wiki = WIKI.exec(title)
  const md = wiki ? null : MD.exec(title)
  const target = wiki ? wiki[1] : md?.[2]
  const label = (wiki ? wiki[2] : md?.[1]) ?? ''
  if (!target) return null
  const hash = target.indexOf('#')
  if (hash < 0) return null
  const place = parsePlaceSubpath(target.slice(hash))
  return place ? { place, label: label.trim(), target: decoded(target.slice(0, hash)) } : null
}

const decoded = (target: string): string => {
  try {
    return decodeURIComponent(target.trim())
  } catch {
    return target.trim()
  }
}

/**
 * Which book a note's callouts are asked about, by the file their place links to, as written: a
 * note several books share holds places in each. Without one, every callout is the book's, as in
 * a book's own note.
 */
export type OfBook = (target: string) => boolean

interface Block {
  highlight: Highlight
  /** Lines `[start, end)` of the note the callout takes. */
  start: number
  end: number
  /** The entry the template's body wrote around it, when a frame is given and it still fits. */
  entry?: EntryMatch
  /** The comment as the callout itself has it. */
  inner: string
  /** The line of the note the entry's forms field is on, when it has one. */
  formsAt?: number
  /** The line of the note the callout's own `forms::` line is, when it has one. */
  inlineAt?: number
  /** The book its place links to, as written. */
  target: string
}

function blocks(
  markdown: string,
  ofBook?: OfBook,
  frame?: EntryFrame
): { lines: string[]; blocks: Block[] } {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const found: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const header = HEADER.exec(lines[i])
    if (!header) continue
    const at = placeIn(header[3].replace(CHAT_LINK, ''))
    if (!at || !('cfi' in at.place) || (ofBook && !ofBook(at.target))) continue
    let end = i + 1
    const body: string[] = []
    while (end < lines.length && /^>/.test(lines[end])) {
      body.push(lines[end].replace(/^>\s?/, ''))
      end++
    }
    // The forms, kept as the callout's own line, are neither the words nor the comment.
    let inlineForms: string[] = []
    let inlineAt: number | undefined
    // Its last line, and only that: a comment may mention forms in passing.
    let formsAt = body.length - 1
    while (formsAt > 0 && !body[formsAt].trim()) formsAt--
    if (formsAt > 0 && FORMS_LINE.test(body[formsAt])) {
      inlineAt = i + 1 + formsAt
      inlineForms = parseForms(FORMS_LINE.exec(body[formsAt])[1])
      body.splice(formsAt, 1)
      while (body.length && !body[body.length - 1].trim()) body.pop()
    }
    const blank = body.findIndex((line) => !line.trim())
    const quote = (blank < 0 ? body : body.slice(0, blank)).join('\n').trim()
    const comment =
      blank < 0
        ? ''
        : body
            .slice(blank + 1)
            .join('\n')
            .trim()
    const discussion = discussionIn(header[3])
    const plain = header[1].toLowerCase() === 'chat'
    found.push({
      highlight: {
        cfi: at.place.cfi,
        color: colorOf(header[2]),
        text: quote,
        comment,
        label: at.label,
        ...(discussion ? { discussion } : {}),
        ...(plain ? { plain } : {}),
        ...(inlineForms.length ? { forms: inlineForms } : {}),
      },
      start: i,
      end,
      inner: comment,
      target: at.target,
      ...(inlineAt !== undefined ? { inlineAt } : {}),
    })
    i = end - 1
  }
  if (frame) withEntries(lines, found, frame, markdown)
  return { lines, blocks: found }
}

/**
 * Each callout's entry, found by the frame; its comment is the field's, where the field has one,
 * or the one the callout keeps from before. An entry reaches no further than the callouts around it.
 */
function withEntries(lines: string[], found: Block[], frame: EntryFrame, markdown: string): void {
  // Every highlight callout bounds an entry, the other books' in a shared note too.
  const all = found.length ? blocks(markdown).blocks : []
  for (const b of found) {
    const prev = all.filter((x) => x.end <= b.start).pop()
    const next = all.find((x) => x.start >= b.end)
    const entry = matchEntry(
      lines,
      b.start,
      b.end,
      frame,
      prev?.end ?? 0,
      next?.start ?? lines.length
    )
    if (!entry) continue
    b.entry = entry
    if (entry.comment?.text) b.highlight.comment = entry.comment.text
    const at = formsLineOf(entry, b.end, frame)
    const written = at === null ? null : formsOnLine(lines[at], frame)
    if (at === null || written === null) continue
    b.formsAt = at
    const forms = parseForms(written)
    if (forms.length) b.highlight.forms = forms
  }
}

/**
 * Every highlight in the note — of the book asked about, if one is — in the order it has them;
 * with the frame of the template's body, comments kept in a field of their own too.
 */
export function parseHighlights(
  markdown: string,
  ofBook?: OfBook,
  frame?: EntryFrame
): Highlight[] {
  return blocks(markdown, ofBook, frame).blocks.map((b) => b.highlight)
}

/**
 * The lines the highlight at `cfi` takes in the note, 1-based and inclusive — found by the place its
 * callout links to, not by its words, which the person may have edited. Null when it is not there.
 */
export function highlightLines(
  markdown: string,
  cfi: string,
  ofBook?: OfBook
): { from: number; to: number } | null {
  const block = blocks(markdown, ofBook).blocks.find((b) => b.highlight.cfi === cfi)
  return block ? { from: block.start + 1, to: block.end } : null
}

/** A link repair never serializes a callout: only the destination's encoded CFI is writable. */
export interface HighlightLinkRepair {
  cfi: string
  text: string
  suggested: string
}

/** Raw line starts and eligibility, including fenced examples and YAML properties. */
function repairLines(markdown: string): { starts: number[]; eligible: Set<number> } {
  const starts: number[] = []
  const eligible = new Set<number>()
  let fence = ''
  let frontmatter = markdown.replace(/^\uFEFF/, '').startsWith('---')
  for (const match of markdown.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const raw = match[0]
    if (!raw && match.index === markdown.length) break
    const index = starts.length
    starts.push(match.index)
    const line = raw.replace(/\r\n?$|\n$/, '')
    if (index === 0 && frontmatter) continue
    if (frontmatter) {
      if (/^---\s*$/.test(line)) frontmatter = false
      continue
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (opening) {
      if (!fence) fence = opening[1]
      else if (opening[1][0] === fence[0] && opening[1].length >= fence.length) fence = ''
      continue
    }
    if (!fence) eligible.add(index)
  }
  return { starts, eligible }
}

/** Offset of the CFI inside a title, never of a discussion link or alias. */
function repairSpan(title: string, cfi: string, ofBook: OfBook): [number, number] | null {
  for (const wiki of title.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g)) {
    const target = wiki[1]
    const hash = target.indexOf('#cfi=')
    if (hash < 0 || !ofBook(decoded(target.slice(0, hash)))) continue
    const place = parsePlaceSubpath(target.slice(hash))
    if (!place || !('cfi' in place) || place.cfi !== cfi) continue
    const from = wiki.index + 2 + hash + 5
    return [from, from + target.length - hash - 5]
  }
  for (const md of title.matchAll(/\[[^\]]*\]\(\s*(<)?([^)>\s]+)>?\s*\)/g)) {
    const target = md[2]
    const hash = target.indexOf('#cfi=')
    if (hash < 0 || !ofBook(decoded(target.slice(0, hash)))) continue
    const place = parsePlaceSubpath(target.slice(hash))
    if (!place || !('cfi' in place) || place.cfi !== cfi) continue
    const from = md.index + md[0].indexOf(target) + hash + 5
    return [from, from + target.length - hash - 5]
  }
  return null
}

/** Only actual callouts, not examples in properties or fenced code, count as repair sources. */
export function repairableHighlights(markdown: string, ofBook: OfBook): Highlight[] {
  const { eligible } = repairLines(markdown)
  return blocks(markdown, ofBook).blocks.filter((b) => eligible.has(b.start)).map((b) => b.highlight)
}

/** Check all requests against one snapshot; apply independent, disjoint spans from right to left. */
export function patchHighlightLinks(
  markdown: string,
  requests: HighlightLinkRepair[],
  ofBook: OfBook
): { markdown: string; applied: string[]; skipped: string[] } {
  const { starts, eligible } = repairLines(markdown)
  const { lines, blocks: found } = blocks(markdown, ofBook)
  const live = found.filter((b) => eligible.has(b.start))
  const edits: { from: number; to: number; value: string; cfi: string }[] = []
  const skipped: string[] = []
  const destinations = requests.map((r) => r.suggested)
  for (const r of requests) {
    const matches = live.filter((b) => b.highlight.cfi === r.cfi)
    if (
      matches.length !== 1 ||
      matches[0].highlight.text !== r.text ||
      r.cfi === r.suggested ||
      requests.filter((x) => x.cfi === r.cfi).length !== 1 ||
      destinations.filter((x) => x === r.suggested).length !== 1 ||
      live.some((b) => b.highlight.cfi === r.suggested && b.highlight.cfi !== r.cfi)
    ) {
      skipped.push(r.cfi)
      continue
    }
    const b = matches[0]
    const header = HEADER.exec(lines[b.start])
    const span = header && repairSpan(header[3], r.cfi, ofBook)
    if (!span) {
      skipped.push(r.cfi)
      continue
    }
    const from = starts[b.start] + header[0].indexOf(header[3]) + span[0]
    edits.push({ from, to: starts[b.start] + header[0].indexOf(header[3]) + span[1], value: encodeCfi(r.suggested), cfi: r.cfi })
  }
  let output = markdown
  for (const e of edits.sort((a, b) => b.from - a.from))
    output = output.slice(0, e.from) + e.value + output.slice(e.to)
  return { markdown: output, applied: edits.map((e) => e.cfi), skipped }
}

/** One highlight as its callout, the links — to the place, to its chat — already made. */
export function highlightBlock(h: Highlight, link: string, chatLink?: string): string {
  const quote = h.text.replace(/\r\n?/g, '\n').trim()
  const kind = h.plain && h.discussion ? 'chat' : `quote|${h.color}`
  const title = h.discussion && chatLink ? `${link} · ${chatLink}` : link
  const lines = [`> [!${kind}] ${title}`, ...quote.split('\n').map((l) => `> ${l}`.trimEnd())]
  const comment = h.comment.replace(/\r\n?/g, '\n').trim()
  if (comment) lines.push('>', ...comment.split('\n').map((l) => `> ${l}`.trimEnd()))
  if (h.forms?.length) lines.push('>', `> forms:: ${formsLine(h.forms)}`)
  return lines.join('\n')
}

/** A new highlights note for a book. */
export function newHighlightsNote(bookLink: string, title: string): string {
  return `---\ntype: ${HIGHLIGHTS_TYPE}\n${BOOK_LINK_KEY}: "${bookLink.replace(/"/g, '\\"')}"\n---\n\n# ${title}\n`
}

/**
 * A book's own note, made from a template, with what says whose it is: `type` and the link back
 * added to its properties when the template does not set them, so it is found again after either
 * file moves. A template that links the book under the old `book` keeps it there.
 */
export function withCompanionProps(markdown: string, bookLink: string): string {
  const book = `${BOOK_LINK_KEY}: "${bookLink.replace(/"/g, '\\"')}"`
  const fm = /^---\n([\s\S]*?)\n?---(\n|$)/.exec(markdown)
  if (!fm) return `---\ntype: ${HIGHLIGHTS_TYPE}\n${book}\n---\n\n${markdown.replace(/^\n+/, '')}`
  const props = fm[1] ? fm[1].split('\n') : []
  const has = (key: string) => props.some((line) => line.startsWith(`${key}:`))
  const added = [
    ...(has('type') ? [] : [`type: ${HIGHLIGHTS_TYPE}`]),
    ...(BOOK_LINK_KEYS.some(has) ? [] : [book]),
  ]
  if (!added.length) return markdown
  return `---\n${[...props, ...added].join('\n')}\n---${fm[2]}${markdown.slice(fm[0].length)}`
}

type Compare = (a: string, b: string) => number

/** How a note is written to: which book's callouts are asked about, and how a new one goes in. */
export interface WriteOptions {
  ofBook?: OfBook
  /** The template body's frame: where a comment with a field of its own is written. */
  frame?: EntryFrame
  /**
   * What a new highlight adds, its callout in it, put at the end of the note; without it the
   * callout goes in the order of the book.
   */
  entry?: string
}

/**
 * The note with the highlight written in: replacing the one at the same place, or — a new one —
 * added at the end as `entry`, or put before the first one that comes after it in the book.
 */
export function upsertHighlight(
  markdown: string,
  h: Highlight,
  link: string,
  compare: Compare,
  chatLink?: string,
  options: WriteOptions = {}
): string {
  const { lines, blocks: found } = blocks(markdown, options.ofBook, options.frame)
  const same = found.find((b) => b.highlight.cfi === h.cfi)
  if (same?.formsAt !== undefined && options.frame) {
    // The forms go to their field, a line the callout's writing below does not move.
    lines[same.formsAt] = withForms(lines[same.formsAt], formsLine(h.forms ?? []), options.frame)
    return upsertIn(lines, same, { ...h, forms: undefined }, link, chatLink)
  }
  return upsertIn(lines, same, h, link, chatLink, found, compare, options)
}

/** `upsertHighlight` once the forms are where they go. */
function upsertIn(
  lines: string[],
  same: Block | undefined,
  h: Highlight,
  link: string,
  chatLink?: string,
  found: Block[] = [],
  compare?: Compare,
  options: WriteOptions = {}
): string {
  const block = highlightBlock(h, link, chatLink).split('\n')
  if (same?.entry?.comment) {
    writeField(lines, same, highlightBlock({ ...h, comment: '' }, link, chatLink), h.comment)
    return lines.join('\n')
  }
  if (same) {
    lines.splice(same.start, same.end - same.start, ...block)
    return lines.join('\n')
  }
  if (options.entry !== undefined) return atEnd(lines, options.entry.split('\n'))
  const after = found.find((b) => {
    try {
      return !!compare && compare(b.highlight.cfi, h.cfi) > 0
    } catch {
      return false
    }
  })
  if (after) {
    lines.splice(after.start, 0, ...block, '')
    return lines.join('\n')
  }
  return atEnd(lines, block)
}

/**
 * The callout and the comment written into an entry whose comment has a field of its own: the
 * callout holding the words alone, the comment in its field. The later lines go first, so the
 * earlier ones stay where they were found.
 */
function writeField(lines: string[], block: Block, callout: string, comment: string): void {
  const region = block.entry.comment
  let field = commentLines(comment, region.lead, region.carry, region.end)
  // An empty field at the edge of the body is no line at all, as the body writes it.
  if (region.edge && isBlankField(field)) field = []
  const after = region.from >= block.end
  const edits: [number, number, string[]][] = [
    [block.start, block.end, callout.split('\n')],
    [region.from, region.to, field],
  ]
  if (after) edits.reverse()
  for (const [from, to, added] of edits) {
    if (added === field && region.to === region.from && added.length) {
      // Put where there was nothing: kept apart from what follows and what comes before.
      const out = [...added]
      if (from < lines.length && lines[from].trim()) out.push('')
      if (from > 0 && lines[from - 1].trim()) out.unshift('')
      lines.splice(from, 0, ...out)
      continue
    }
    lines.splice(from, to - from, ...added)
    if (added === field && !added.length && from > 0 && !lines[from - 1].trim()) {
      // A field emptied at the edge of the body: its blank line goes with it.
      if (from < lines.length && !lines[from].trim()) lines.splice(from, 1)
    }
  }
}

/** The note's lines with `added` at the end, after one blank line. */
function atEnd(lines: string[], added: string[]): string {
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (lines.length) lines.push('')
  lines.push(...added, '')
  return lines.join('\n')
}

/**
 * The note without the highlight at `cfi`, and without the blank line it leaves behind. With a
 * `frame`, the lines the template wrote around it go too, when they still read as written.
 */
export function removeHighlight(
  markdown: string,
  cfi: string,
  options: { ofBook?: OfBook; frame?: EntryFrame } = {}
): string {
  const { lines, blocks: found } = blocks(markdown, options.ofBook, options.frame)
  const block = found.find((b) => b.highlight.cfi === cfi)
  if (!block) return markdown
  let { start, end } = block.entry ?? block
  if (end < lines.length && !lines[end].trim() && start > 0 && !lines[start - 1].trim()) end++
  lines.splice(start, end - start)
  return lines.join('\n')
}

/** Where a highlight's forms are written in its note, for them to be shown as a link. */
export interface FormsPlace {
  /** The line, from 0, and the characters of it the forms take, `[from, to)`. */
  line: number
  from: number
  to: number
  forms: string[]
  /** The book the highlight's place links to, as written. */
  book: string
}

/**
 * Every place in the note its highlights' forms are written — a callout's `forms::` line, or,
 * with a frame, the template's `{{ forms }}` field — the forms named there, and their book.
 */
export function formsPlaces(markdown: string, frame?: EntryFrame): FormsPlace[] {
  const { lines, blocks: found } = blocks(markdown, undefined, frame)
  const out: FormsPlace[] = []
  for (const b of found) {
    const forms = b.highlight.forms
    if (!forms?.length) continue
    const field =
      b.formsAt !== undefined && frame?.forms
        ? new RegExp(frame.forms.pattern.source, 'd').exec(lines[b.formsAt])?.indices?.[1]
        : undefined
    if (field && field[1] > field[0])
      out.push({ line: b.formsAt, from: field[0], to: field[1], forms, book: b.target })
    else if (b.inlineAt !== undefined) {
      const line = lines[b.inlineAt]
      const lead = /^>\s?forms::[ \t]*/i.exec(line)?.[0].length ?? 0
      const to = line.trimEnd().length
      if (to > lead) out.push({ line: b.inlineAt, from: lead, to, forms, book: b.target })
    }
  }
  return out
}
