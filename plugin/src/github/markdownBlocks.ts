/**
 * A markdown file cut into its top-level blocks, each with the source lines it came from.
 *
 * The file preview renders block by block so that every rendered block knows its lines: that is
 * what lets a person select lines from the rendered page and get the same `#L10-L20` link the code
 * view gives. A block is only split off where markdown itself would end one, because a split
 * anywhere else renders differently from the whole file — so this follows CommonMark's block
 * rules closely enough for that, and no further. Inline syntax is never parsed.
 *
 * A list is split into its top-level items, each its own block, so a long list can be linked item
 * by item; the item carries its number in the list so an ordered list still counts 1, 2, 3 when
 * its items are rendered apart.
 */

export type MdBlockKind =
  | 'frontmatter'
  | 'heading'
  | 'paragraph'
  | 'table'
  | 'list-item'
  | 'code'
  | 'math'
  | 'quote'
  | 'html'
  | 'rule'
  | 'definitions'
  | 'footnote'

export interface MdBlock {
  kind: MdBlockKind
  /** First and last source line, 1-based and inclusive; blank lines around are not included. */
  start: number
  end: number
  /** A heading's anchor, as GitHub writes it: `#getting-started`. */
  slug?: string
  /** A list item: its place in its list, and the number an ordered one is shown with. */
  list?: { index: number; number?: number }
  /** A footnote definition: its label, `1` for `[^1]:`. */
  footnote?: string
}

const BLANK = /^\s*$/
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const LIST = /^( {0,3})([-+*]|(\d{1,9})([.)]))([ \t]+|$)(.*)$/
const QUOTE = /^ {0,3}>/
const MATH = /^ {0,3}\$\$/
const DEFINITION = /^ {0,3}\[(?:[^\]\\]|\\.)+\]:\s*\S/
const FOOTNOTE = /^ {0,3}\[\^([^\]\s]+)\]:/
const TABLE_DELIMITER = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** HTML that starts a block and ends at a blank line (CommonMark's kind 6). */
const HTML_BLOCK_TAGS = new Set(
  (
    'address article aside base basefont blockquote body caption center col colgroup dd details ' +
    'dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 ' +
    'head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option ' +
    'p param search section summary table tbody td tfoot th thead title tr track ul'
  ).split(' ')
)
/** HTML blocks that end where their own closing mark is, blank lines or not (kinds 1–5). */
const HTML_RAW: [RegExp, RegExp][] = [
  [/^ {0,3}<(script|pre|style|textarea)(\s|>|$)/i, /<\/(script|pre|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<![A-Za-z]/, />/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
]
const HTML_TAG = /^ {0,3}<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/
/** A whole open or close tag alone on its line (kind 7), which cannot interrupt a paragraph. */
const HTML_LONE_TAG =
  /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)\s*$/

/** Columns of leading whitespace, a tab reaching the next multiple of four. */
function indentOf(line: string): number {
  let col = 0
  for (const ch of line) {
    if (ch === ' ') col++
    else if (ch === '\t') col += 4 - (col % 4)
    else break
  }
  return col
}

interface Fence {
  char: string
  length: number
}

function fenceOpen(line: string): Fence | null {
  const m = FENCE.exec(line)
  if (!m) return null
  // A backtick fence's info string may not hold a backtick: that is inline code.
  if (m[2][0] === '`' && m[3].includes('`')) return null
  return { char: m[2][0], length: m[2].length }
}

/** Whether `line` closes `fence`; inside a list item it may be indented as far as the item is. */
function fenceCloses(line: string, fence: Fence, maxIndent = 3): boolean {
  if (indentOf(line) > maxIndent) return false
  const m = /^(`{3,}|~{3,})[ \t]*$/.exec(line.trimStart())
  return !!m && m[1][0] === fence.char && m[1].length >= fence.length
}

interface ListMarker {
  /** Columns before the content starts: what a continuation line must be indented by. */
  contentIndent: number
  ordered: boolean
  number?: number
  /** `-`, `+`, `*`, `.` or `)`: a different one starts a different list. */
  delimiter: string
  empty: boolean
}

function listMarker(line: string): ListMarker | null {
  if (RULE.test(line)) return null
  const m = LIST.exec(line)
  if (!m) return null
  const indent = m[1].length
  const marker = m[2].length
  const spaces = m[5]
  const empty = BLANK.test(m[6] ?? '')
  // Five spaces or more after the marker: the content starts after one, the rest is code.
  const gap = empty || indentOf(spaces) > 4 ? 1 : indentOf(spaces)
  const ordered = m[3] !== undefined
  return {
    contentIndent: indent + marker + gap,
    ordered,
    number: ordered ? Number(m[3]) : undefined,
    delimiter: ordered ? m[4] : m[2],
    empty,
  }
}

type HtmlStart = { end: RegExp } | { blank: true; tag?: string } | null

function htmlStart(line: string, interrupting: boolean): HtmlStart {
  for (const [start, end] of HTML_RAW) if (start.test(line)) return { end }
  const tag = HTML_TAG.exec(line)
  if (tag && HTML_BLOCK_TAGS.has(tag[1].toLowerCase())) {
    const closing = /^ {0,3}<\//.test(line)
    return { blank: true, tag: closing ? undefined : tag[1].toLowerCase() }
  }
  if (!interrupting && HTML_LONE_TAG.test(line)) {
    const closing = /^ {0,3}<\//.test(line) || /\/>\s*$/.test(line)
    return { blank: true, tag: closing || !tag ? undefined : tag[1].toLowerCase() }
  }
  return null
}

/** Whether a line starts a block that ends a paragraph running into it. */
function interrupts(line: string): boolean {
  if (ATX.test(line) || fenceOpen(line) || RULE.test(line) || QUOTE.test(line) || MATH.test(line))
    return true
  if (htmlStart(line, true)) return true
  const item = listMarker(line)
  // Only a bullet with text, or an ordered item numbered 1, may break into a paragraph.
  return !!item && !item.empty && (!item.ordered || item.number === 1)
}

/**
 * The text of a heading as GitHub makes its anchor: inline markup dropped, lower case, anything
 * but letters, digits, spaces, `-` and `_` removed, spaces made dashes.
 */
export function githubSlug(text: string): string {
  const plain = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*~]|(?<!\w)_|_(?!\w)/g, '')
  return plain
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-')
}

export function splitMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  const n = lines.length
  const blank = (i: number) => i >= n || BLANK.test(lines[i])
  /** The last non-blank line before `i`, going back no further than `from`. */
  const trimEnd = (from: number, i: number) => {
    let end = i
    while (end > from && blank(end)) end--
    return end
  }
  const push = (kind: MdBlockKind, from: number, to: number, extra: Partial<MdBlock> = {}) =>
    blocks.push({ kind, start: from + 1, end: to + 1, ...extra })

  /** Index of the line closing a fence opened at `from`, or the last line of the file. */
  const fenceEnd = (from: number, fence: Fence) => {
    for (let i = from + 1; i < n; i++) if (fenceCloses(lines[i], fence)) return i
    return n - 1
  }

  let list: { ordered: boolean; delimiter: string; index: number; number?: number } | null = null
  let i = 0

  // Front matter: only on the very first line, and only when it closes.
  if (/^---\s*$/.test(lines[0])) {
    for (let j = 1; j < n; j++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[j])) {
        push('frontmatter', 0, j)
        i = j + 1
        break
      }
    }
  }

  while (i < n) {
    if (blank(i)) {
      i++
      continue
    }
    const line = lines[i]
    const start = i
    const item = listMarker(line)
    // A list goes on through blank lines until something that is not its next item.
    if (!item) list = null

    const fence = fenceOpen(line)
    if (fence) {
      i = fenceEnd(start, fence) + 1
      push('code', start, trimEnd(start, i - 1))
      continue
    }

    if (MATH.test(line)) {
      const rest = line.replace(/^ {0,3}\$\$/, '')
      let end = start
      if (!rest.includes('$$')) {
        end = n - 1
        for (let j = start + 1; j < n; j++) {
          if (lines[j].includes('$$')) {
            end = j
            break
          }
        }
      }
      push('math', start, trimEnd(start, end))
      i = end + 1
      continue
    }

    const atx = ATX.exec(line)
    if (atx) {
      push('heading', start, start, { slug: githubSlug(atx[2] ?? '') })
      i++
      continue
    }

    if (RULE.test(line)) {
      push('rule', start, start)
      i++
      continue
    }

    if (item) {
      const end = listItemEnd(start, item.contentIndent)
      const same = list && list.ordered === item.ordered && list.delimiter === item.delimiter
      if (same && list) {
        list.index++
        if (list.number !== undefined) list.number++
      } else {
        list = {
          ordered: item.ordered,
          delimiter: item.delimiter,
          index: 0,
          number: item.number,
        }
      }
      push('list-item', start, end, { list: { index: list.index, number: list.number } })
      i = end + 1
      continue
    }

    if (QUOTE.test(line)) {
      let j = start + 1
      while (j < n && !blank(j) && (QUOTE.test(lines[j]) || !interrupts(lines[j]))) j++
      push('quote', start, j - 1)
      i = j
      continue
    }

    const html = htmlStart(line, false)
    if (html) {
      const end = htmlEnd(start, html)
      push('html', start, end)
      i = end + 1
      continue
    }

    if (indentOf(line) >= 4) {
      let j = start + 1
      let last = start
      while (j < n && (blank(j) || indentOf(lines[j]) >= 4)) {
        if (!blank(j)) last = j
        j++
      }
      push('code', start, last)
      i = last + 1
      continue
    }

    const footnote = FOOTNOTE.exec(line)
    if (footnote) {
      const end = listItemEnd(start, 4)
      push('footnote', start, end, { footnote: footnote[1] })
      i = end + 1
      continue
    }

    // A paragraph, or a table, or a setext heading: to the blank line or what breaks in.
    let j = start + 1
    let setext = false
    while (j < n && !blank(j)) {
      if (SETEXT.test(lines[j])) {
        setext = true
        j++
        break
      }
      if (interrupts(lines[j])) break
      j++
    }
    const end = j - 1
    const text = lines.slice(start, setext ? end : end + 1)
    if (setext) push('heading', start, end, { slug: githubSlug(text.join(' ')) })
    else if (text.every((l) => DEFINITION.test(l))) push('definitions', start, end)
    else if (text.length > 1 && line.includes('|') && TABLE_DELIMITER.test(text[1]))
      push('table', start, end)
    else push('paragraph', start, end)
    i = j
  }

  numberHeadings(blocks)
  return blocks

  /**
   * The last line of a list item, or a footnote, whose content starts at `indent`: indented lines
   * and blank lines followed by indented lines are its; so is a line running lazily on from its
   * text, unless that line starts something else.
   */
  function listItemEnd(from: number, indent: number): number {
    let last = from
    let j = from + 1
    let lazy = !BLANK.test(lines[from].slice(indent))
    while (j < n) {
      if (blank(j)) {
        lazy = false
        j++
        continue
      }
      const l = lines[j]
      if (indentOf(l) >= indent) {
        const inner = indentOf(l) - indent <= 3 ? fenceOpen(l.trimStart()) : null
        if (inner) {
          // A fence inside the item: to its closing fence, or to a line less indented than
          // the item, which closes the item and the fence with it.
          let k = j + 1
          const closes = (k: number) => fenceCloses(lines[k], inner, indent + 3)
          while (k < n && !closes(k)) {
            if (!blank(k) && indentOf(lines[k]) < indent) break
            k++
          }
          if (k < n && closes(k)) {
            last = k
            j = k + 1
          } else {
            last = trimEnd(j, k - 1)
            j = k
          }
          lazy = false
          continue
        }
        last = j
        lazy = true
        j++
        continue
      }
      // Less indented: only a lazy line of the item's own paragraph, straight after it.
      const starts = interrupts(l) || !!listMarker(l) || SETEXT.test(l) || FOOTNOTE.test(l)
      if (lazy && j === last + 1 && !starts) {
        last = j
        j++
        continue
      }
      break
    }
    return last
  }

  /** The last line of an HTML block starting at `from`. */
  function htmlEnd(from: number, start: NonNullable<HtmlStart>): number {
    if ('end' in start) {
      for (let j = from; j < n; j++) if (start.end.test(lines[j])) return j
      return n - 1
    }
    let end = from
    while (end + 1 < n && !blank(end + 1)) end++
    // An element left open at the blank line — a `<details>` around markdown — goes on to where
    // it closes, when it does; one that never closes is left to the blank line.
    if (!start.tag) return end
    const open = new RegExp(`<${start.tag}(?=[\\s>/])`, 'gi')
    const close = new RegExp(`</${start.tag}\\s*>`, 'gi')
    let depth = 0
    let fence: Fence | null = null
    for (let j = from; j < n; j++) {
      const l = lines[j]
      if (fence) {
        if (fenceCloses(l, fence)) fence = null
        continue
      }
      if (j > from) {
        const f = fenceOpen(l)
        if (f) {
          fence = f
          continue
        }
      }
      depth += (l.match(open) ?? []).length - (l.match(close) ?? []).length
      if (depth <= 0) return Math.max(j, end)
    }
    return end
  }
}

/** Repeated headings get `-1`, `-2` on their anchors, as GitHub numbers them. */
function numberHeadings(blocks: MdBlock[]): void {
  const seen = new Map<string, number>()
  for (const b of blocks) {
    if (b.slug === undefined) continue
    const count = seen.get(b.slug) ?? 0
    seen.set(b.slug, count + 1)
    if (count > 0) b.slug = `${b.slug}-${count}`
  }
}
