/**
 * A book's highlights, kept in an ordinary note beside it, one callout per highlight:
 *
 * ```markdown
 * ---
 * type: book-highlights
 * book: "[[Books/Dune.epub]]"
 * ---
 *
 * > [!quote|yellow] [[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]]
 * > Fear is the mind-killer.
 * >
 * > My note on it.
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
}

export const HIGHLIGHTS_TYPE = 'book-highlights'

const HEADER = /^>\s*\[!quote(?:\|([a-z]+))?\][+-]?\s*(.*)$/i
/** The link in a callout title: a wikilink or a markdown link, its target and label. */
const WIKI = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/
const MD = /\[([^\]]*)\]\(\s*<?([^)>\s]+)>?\s*\)/

const colorOf = (value: string | undefined): HighlightColor =>
  (HIGHLIGHT_COLORS as readonly string[]).includes((value ?? '').toLowerCase())
    ? ((value ?? '').toLowerCase() as HighlightColor)
    : 'yellow'

/** The place a callout title links to, and its label; null when the title is no place. */
function placeIn(title: string): { place: BookPlace; label: string } | null {
  const wiki = WIKI.exec(title)
  const md = wiki ? null : MD.exec(title)
  const target = wiki ? wiki[1] : md?.[2]
  const label = (wiki ? wiki[2] : md?.[1]) ?? ''
  if (!target) return null
  const hash = target.indexOf('#')
  if (hash < 0) return null
  const place = parsePlaceSubpath(target.slice(hash))
  return place ? { place, label: label.trim() } : null
}

interface Block {
  highlight: Highlight
  /** Lines `[start, end)` of the note the callout takes. */
  start: number
  end: number
}

function blocks(markdown: string): { lines: string[]; blocks: Block[] } {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const found: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const header = HEADER.exec(lines[i])
    if (!header) continue
    const at = placeIn(header[2])
    if (!at || !('cfi' in at.place)) continue
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
    found.push({
      highlight: {
        cfi: at.place.cfi,
        color: colorOf(header[1]),
        text: quote,
        comment,
        label: at.label,
      },
      start: i,
      end,
    })
    i = end - 1
  }
  return { lines, blocks: found }
}

/** Every highlight in the note, in the order it has them. */
export function parseHighlights(markdown: string): Highlight[] {
  return blocks(markdown).blocks.map((b) => b.highlight)
}

/** One highlight as its callout, the link already made. */
export function highlightBlock(h: Highlight, link: string): string {
  const quote = h.text.replace(/\r\n?/g, '\n').trim()
  const lines = [
    `> [!quote|${h.color}] ${link}`,
    ...quote.split('\n').map((l) => `> ${l}`.trimEnd()),
  ]
  const comment = h.comment.replace(/\r\n?/g, '\n').trim()
  if (comment) lines.push('>', ...comment.split('\n').map((l) => `> ${l}`.trimEnd()))
  return lines.join('\n')
}

/** A new highlights note for a book. */
export function newHighlightsNote(bookLink: string, title: string): string {
  return `---\ntype: ${HIGHLIGHTS_TYPE}\nbook: "${bookLink.replace(/"/g, '\\"')}"\n---\n\n# ${title}\n`
}

type Compare = (a: string, b: string) => number

/**
 * The note with the highlight written in: replacing the one at the same place, or put before the
 * first one that comes after it in the book, or at the end.
 */
export function upsertHighlight(
  markdown: string,
  h: Highlight,
  link: string,
  compare: Compare
): string {
  const { lines, blocks: found } = blocks(markdown)
  const block = highlightBlock(h, link).split('\n')
  const same = found.find((b) => b.highlight.cfi === h.cfi)
  if (same) {
    lines.splice(same.start, same.end - same.start, ...block)
    return lines.join('\n')
  }
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
  // At the end, after one blank line.
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  lines.push('', ...block, '')
  return lines.join('\n')
}

/** The note without the highlight at `cfi`, and without the blank line it leaves behind. */
export function removeHighlight(markdown: string, cfi: string): string {
  const { lines, blocks: found } = blocks(markdown)
  const block = found.find((b) => b.highlight.cfi === cfi)
  if (!block) return markdown
  let end = block.end
  if (end < lines.length && !lines[end].trim() && block.start > 0 && !lines[block.start - 1].trim())
    end++
  lines.splice(block.start, end - block.start)
  return lines.join('\n')
}
