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
 * Everything here works on the note's text, so the rules are tested without a vault.
 */
import { parsePlaceSubpath, type BookPlace } from './bookLinks'

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
}

export const HIGHLIGHTS_TYPE = 'book-highlights'

/**
 * The property a highlights note links back to its book in: a File property, drawn as the book's
 * card. Notes written before it used `book`, which is still read (`BOOK_LINK_KEYS`) and never
 * rewritten.
 */
export const BOOK_LINK_KEY = 'file'
export const BOOK_LINK_KEYS = [BOOK_LINK_KEY, 'book'] as const

const HEADER = /^>\s*\[!(quote|chat)(?:\|([a-z]+))?\][+-]?\s*(.*)$/i
/** A link to a chat file in a callout title, its basename being the discussion's id. */
const CHAT_LINK =
  /\[\[([^\]|]+?\.abchat)(?:\|[^\]]*)?\]\]|\[[^\]]*\]\(\s*<?([^)>\s]+\.abchat)>?\s*\)/i
/** The link in a callout title: a wikilink or a markdown link, its target and label. */
const WIKI = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/
const MD = /\[([^\]]*)\]\(\s*<?([^)>\s]+)>?\s*\)/

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
}

function blocks(markdown: string, ofBook?: OfBook): { lines: string[]; blocks: Block[] } {
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
      },
      start: i,
      end,
    })
    i = end - 1
  }
  return { lines, blocks: found }
}

/** Every highlight in the note — of the book asked about, if one is — in the order it has them. */
export function parseHighlights(markdown: string, ofBook?: OfBook): Highlight[] {
  return blocks(markdown, ofBook).blocks.map((b) => b.highlight)
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

/** One highlight as its callout, the links — to the place, to its chat — already made. */
export function highlightBlock(h: Highlight, link: string, chatLink?: string): string {
  const quote = h.text.replace(/\r\n?/g, '\n').trim()
  const kind = h.plain && h.discussion ? 'chat' : `quote|${h.color}`
  const title = h.discussion && chatLink ? `${link} · ${chatLink}` : link
  const lines = [`> [!${kind}] ${title}`, ...quote.split('\n').map((l) => `> ${l}`.trimEnd())]
  const comment = h.comment.replace(/\r\n?/g, '\n').trim()
  if (comment) lines.push('>', ...comment.split('\n').map((l) => `> ${l}`.trimEnd()))
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
  const { lines, blocks: found } = blocks(markdown, options.ofBook)
  const block = highlightBlock(h, link, chatLink).split('\n')
  const same = found.find((b) => b.highlight.cfi === h.cfi)
  if (same) {
    lines.splice(same.start, same.end - same.start, ...block)
    return lines.join('\n')
  }
  if (options.entry !== undefined) return atEnd(lines, options.entry.split('\n'))
  const after = found.find((b) => {
    try {
      return compare(b.highlight.cfi, h.cfi) > 0
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

/** The note's lines with `added` at the end, after one blank line. */
function atEnd(lines: string[], added: string[]): string {
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (lines.length) lines.push('')
  lines.push(...added, '')
  return lines.join('\n')
}

/** The lines a template's body writes around a highlight, as `entryFrame` gives them. */
export interface EntryFrame {
  before: RegExp[]
  after: RegExp[]
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
  const { lines, blocks: found } = blocks(markdown, options.ofBook)
  const block = found.find((b) => b.highlight.cfi === cfi)
  if (!block) return markdown
  let { start, end } = block
  const { before = [], after = [] } = options.frame ?? {}
  const fits = (from: number, patterns: RegExp[]) =>
    from >= 0 &&
    from + patterns.length <= lines.length &&
    patterns.every((p, i) => p.test(lines[from + i]))
  if ((before.length || after.length) && fits(start - before.length, before) && fits(end, after)) {
    start -= before.length
    end += after.length
  }
  if (end < lines.length && !lines[end].trim() && start > 0 && !lines[start - 1].trim()) end++
  lines.splice(start, end - start)
  return lines.join('\n')
}
