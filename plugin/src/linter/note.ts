/**
 * A note's text taken apart for the rules, and put back together by their fixes.
 *
 * Everything here is pure text. The properties are parsed with js-yaml's core schema — dates stay
 * the strings they were typed as, the way Obsidian shows them — and a duplicated key is an error,
 * which Obsidian itself answers by showing no properties at all.
 *
 * The edits change the lines of one property and nothing else: the rest of the block keeps its
 * order, its quoting and its comments. Going through `processFrontMatter` would have written the
 * whole block anew in Obsidian's own style, a diff of every line for a fix of one.
 */
import { CORE_SCHEMA, dump, load } from 'js-yaml'
import type { LintNote } from './types'

const FENCE = '---'

const isFence = (line: string | undefined): boolean =>
  line !== undefined && line.trimEnd() === FENCE

/** The line break the file already uses, so a fix does not change every line of it. */
export function lineBreakOf(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

export function splitLines(content: string): string[] {
  return content.split(/\r?\n/)
}

interface ParsedBlock {
  data: Record<string, unknown> | null
  error: string
  /** 1-based line of the error in the file, 0 for the block as a whole. */
  errorLine: number
}

/** Parses the lines between the fences; `firstLine` is the file line of the first of them. */
export function parseProperties(raw: string, firstLine: number): ParsedBlock {
  try {
    const data = load(raw, { schema: CORE_SCHEMA }) ?? {}
    if (typeof data !== 'object' || Array.isArray(data)) {
      return {
        data: null,
        error: 'the properties are not a list of names and values',
        errorLine: 0,
      }
    }
    return { data: data as Record<string, unknown>, error: '', errorLine: 0 }
  } catch (err) {
    const e = err as { reason?: string; message?: string; mark?: { line?: number } }
    const reason = (e.reason || e.message || String(err)).split('\n')[0]
    const line = typeof e.mark?.line === 'number' ? firstLine + e.mark.line : 0
    return { data: null, error: reason, errorLine: line }
  }
}

export interface NoteFacts {
  path: string
  ctime?: number
  mtime?: number
}

/** The note as the rules see it. */
export function readNote(content: string, facts: NoteFacts): LintNote {
  const lines = splitLines(content)
  const slash = facts.path.lastIndexOf('/')
  const file = slash < 0 ? facts.path : facts.path.slice(slash + 1)
  const note: LintNote = {
    path: facts.path,
    name: file.replace(/\.md$/i, ''),
    folder: slash < 0 ? '' : facts.path.slice(0, slash),
    content,
    lines,
    frontmatter: null,
    hasFrontmatter: false,
    frontmatterError: '',
    frontmatterErrorLine: 0,
    frontmatterEnd: 0,
    bodyStart: 1,
    body: content,
    ctime: facts.ctime ?? 0,
    mtime: facts.mtime ?? 0,
  }
  if (!isFence(lines[0])) return note

  note.hasFrontmatter = true
  const end = lines.findIndex((line, i) => i > 0 && isFence(line))
  if (end < 0) {
    note.frontmatterError = 'the properties are never closed with a line of ---'
    note.frontmatterErrorLine = 1
    return note
  }
  const parsed = parseProperties(lines.slice(1, end).join('\n'), 2)
  note.frontmatter = parsed.data
  note.frontmatterError = parsed.error
  note.frontmatterErrorLine = parsed.errorLine
  note.frontmatterEnd = end + 1
  note.bodyStart = end + 2
  note.body = lines.slice(end + 1).join(lineBreakOf(content))
  return note
}

/** How far down a properties block may have slipped and still be recognised as one. */
const SLIP_WINDOW = 12

/** A line a properties block could hold: `key: value`, a list item, an indented continuation. */
const YAML_LIKE = /^(\s+\S|-\s|[^\s#:][^:]*:(\s|$)|["'][^"']+["']\s*:(\s|$)|#)/

/**
 * A properties block that is not on the first line, where Obsidian does not look for one — after
 * a byte-order mark, blank lines, or text put above it. Null when there is none.
 *
 * Only a block near the top counts, with every line in it shaped like YAML and the whole of it a
 * set of properties: a note is allowed a horizontal rule, and a pair of them around a paragraph
 * is not a properties block.
 */
export function slippedProperties(
  note: LintNote
): { start: number; end: number; onlyBlankAbove: boolean } | null {
  if (note.hasFrontmatter) return null
  const lines = note.lines.map((line, i) => (i === 0 ? line.replace(/^\uFEFF/, '') : line))
  for (let i = 0; i < Math.min(lines.length, SLIP_WINDOW); i++) {
    if (!isFence(lines[i])) continue
    const end = lines.findIndex((line, j) => j > i && isFence(line))
    if (end < 0 || end === i + 1) return null
    const inner = lines.slice(i + 1, end)
    if (!inner.every((line) => !line.trim() || YAML_LIKE.test(line))) return null
    if (!inner.some((line) => /^[^\s#-][^:]*:(\s|$)/.test(line))) return null
    const parsed = parseProperties(inner.join('\n'), i + 2)
    if (!parsed.data) return null
    const above = lines.slice(0, i)
    return { start: i + 1, end: end + 1, onlyBlankAbove: above.every((line) => !line.trim()) }
  }
  return null
}

/** A top-level property's lines inside the block, 0-based over the file's lines, end exclusive. */
export interface PropertyEntry {
  key: string
  start: number
  end: number
}

const KEY_LINE = /^(?:"([^"]+)"|'([^']+)'|([^\s#"'][^:]*?))\s*:(\s|$)/

/** The block's top-level properties, in order. Empty without a closed block. */
export function propertyEntries(lines: string[], closing: number): PropertyEntry[] {
  const out: PropertyEntry[] = []
  for (let i = 1; i < closing; i++) {
    const m = KEY_LINE.exec(lines[i])
    if (m) {
      if (out.length) out[out.length - 1].end = i
      out.push({ key: m[1] ?? m[2] ?? m[3], start: i, end: closing })
    }
  }
  // A property's last lines are not its own when they are blank or a comment before the fence.
  for (const entry of out) {
    while (entry.end - 1 > entry.start && /^\s*(#.*)?$/.test(lines[entry.end - 1])) entry.end--
  }
  return out
}

/** A `# comment` ending a line of YAML — outside quotes, after a space — or empty. */
export function trailingComment(line: string): string {
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '#' && i > 0 && /\s/.test(line[i - 1])) {
      return line.slice(i).trimEnd()
    }
  }
  return ''
}

/** `key: value` as a line or lines of YAML, in the plain style the core schema reads back. */
export function propertyLines(key: string, value: unknown): string[] {
  return dump({ [key]: value }, { schema: CORE_SCHEMA, lineWidth: -1 })
    .trimEnd()
    .split('\n')
}

/** The note without the property. Unchanged when it has no such property, or no readable block. */
export function withoutProperty(content: string, key: string): string {
  const lines = splitLines(content)
  if (!isFence(lines[0])) return content
  const closing = lines.findIndex((line, i) => i > 0 && isFence(line))
  if (closing < 0) return content
  const found = propertyEntries(lines, closing).filter((e) => e.key === key)
  if (!found.length) return content
  const keep = lines.filter((_, i) => !found.some((e) => i >= e.start && i < e.end))
  return keep.join(lineBreakOf(content))
}

/**
 * The note with the property set to `value`: its lines replaced where it is there, added at the
 * end of the block where it is not, and a block made for it where the note has none.
 */
export function withProperty(content: string, key: string, value: unknown): string {
  const br = lineBreakOf(content)
  const lines = splitLines(content)
  const written = propertyLines(key, value)
  if (!isFence(lines[0])) {
    const head = [FENCE, ...written, FENCE]
    const rest = content === '' ? [] : lines[0].trim() ? ['', ...lines] : lines
    return [...head, ...rest].join(br) + (content === '' ? br : '')
  }
  const closing = lines.findIndex((line, i) => i > 0 && isFence(line))
  if (closing < 0) return content
  const found = propertyEntries(lines, closing).find((e) => e.key === key)
  if (found) {
    // A comment on the property's own line stays there, after its new value.
    const comment = trailingComment(lines[found.start])
    if (comment && written.length === 1) written[0] += ` ${comment}`
    lines.splice(found.start, found.end - found.start, ...written)
  } else {
    lines.splice(closing, 0, ...written)
  }
  return lines.join(br)
}

/** The value as the settings list typed it: `key: value`, split once at the first colon. */
export function keyAndDefault(entry: string): { key: string; value: string | null } {
  const at = entry.indexOf(':')
  if (at < 0) return { key: entry.trim(), value: null }
  return { key: entry.slice(0, at).trim(), value: entry.slice(at + 1).trim() }
}

/** Filled in, the way a person reads a property: an empty string or list is not. */
export function filled(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

/**
 * The body's lines outside fenced code, with their 1-based line numbers: a `#` in a code block
 * is not a heading and a `#word` there is not a tag.
 */
export function proseLines(note: LintNote): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  let fence: string | null = null
  for (let i = note.bodyStart - 1; i < note.lines.length; i++) {
    const text = note.lines[i]
    const marker = /^\s*(`{3,}|~{3,})/.exec(text)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
      continue
    }
    if (marker) {
      fence = marker[1]
      continue
    }
    out.push({ line: i + 1, text })
  }
  return out
}
