/**
 * Links to lines of a note: `[[Folder/Note#L10]]`, `[[Folder/Note#L10-L12|text]]`,
 * `[text](Folder/Note.md#L10-L12)`.
 *
 * The line range rides in the link's subpath, where a heading would go. Plain Obsidian reads it
 * as a heading that does not exist and simply opens the note — the link still resolves, is not
 * styled as unresolved and counts in the graph and backlinks — so a note carrying one stays
 * readable without the plugin. With it, the note opens at those lines.
 *
 * Lines are counted the way `read` numbers them: from 1, over the whole file, frontmatter
 * included.
 */

/** 1-based and inclusive; `from` is never after `to`. */
export interface LineRange {
  from: number
  to: number
}

const LINE_SUBPATH = /^#?L(\d+)(?:-L?(\d+))?$/i

/** `#L10` or `#L10-L12` (also `#L10-12`) as a range; null for anything else, a heading included. */
export function parseLineSubpath(subpath: string): LineRange | null {
  const m = LINE_SUBPATH.exec(subpath.trim())
  if (!m) return null
  const a = Math.max(1, Number(m[1]))
  const b = m[2] === undefined ? a : Math.max(1, Number(m[2]))
  return { from: Math.min(a, b), to: Math.max(a, b) }
}

/** The subpath for a range, the form agents are told to write. */
export function lineSubpath(range: LineRange): string {
  return range.from === range.to ? `#L${range.from}` : `#L${range.from}-L${range.to}`
}

export interface LineLink {
  /** The note, as written in the link: a path or a name, with or without `.md`. */
  linkpath: string
  lines: LineRange
}

function decode(text: string): string {
  if (!text.includes('%')) return text
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** A link's target split into note and lines, when it points at lines; null otherwise. */
export function parseLineLink(href: string): LineLink | null {
  const target = decode(href.trim())
  const hash = target.indexOf('#')
  if (hash <= 0) return null
  const lines = parseLineSubpath(target.slice(hash))
  if (!lines) return null
  return { linkpath: target.slice(0, hash).trim(), lines }
}

/** A URL with a scheme — `https:`, `obsidian:`, `mailto:` — is not a link to a note. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** `[[target|alias]]` (not `![[…]]`), `[text](<target>)` and `[text](target)` (not `![…]`). */
const INTERNAL_PATTERNS: RegExp[] = [
  /(?<!!)\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g,
  /(?<!!)\[(?:[^\]\\]|\\.)*\]\(\s*<([^>]+)>[^)]*\)/g,
  /(?<!!)\[(?:[^\]\\]|\\.)*\]\(\s*([^\s)<]+)[^)]*\)/g,
]

/**
 * The target of the internal link covering `offset` in a line of markdown, or null.
 *
 * What Live Preview needs: there a link is styled text, not an element with an address, so the
 * address is read back out of the line under the pointer.
 */
export function internalLinkInLine(text: string, offset: number): string | null {
  for (const pattern of INTERNAL_PATTERNS) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text))) {
      const from = m.index
      const to = from + m[0].length
      if (offset < from || offset > to) continue
      const target = m[1].trim()
      return HAS_SCHEME.test(target) ? null : target
    }
  }
  return null
}

/** Keeps a range inside a note of `lineCount` lines: past the end means the last line. */
export function clampRange(range: LineRange, lineCount: number): LineRange {
  const last = Math.max(1, lineCount)
  const clamp = (n: number) => Math.min(Math.max(1, n), last)
  return { from: clamp(range.from), to: clamp(range.to) }
}
