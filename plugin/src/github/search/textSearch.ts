/**
 * The query language shared by every search over code here — the tab's code search, the
 * definition lookup and the agent's `github_grep`: plain text or a regular expression, with or
 * without letter case, and an optional path glob.
 */

export interface CodeQuery {
  text: string
  regex?: boolean
  caseSensitive?: boolean
  /** Only whole words — for "find references". */
  wholeWord?: boolean
}

export interface LineMatch {
  /** 1-based. */
  line: number
  /** 0-based, in UTF-16 units of the line. */
  column: number
  length: number
  /** The line itself, cut to a readable length around the match. */
  text: string
}

export class QueryError extends Error {}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The query as a global regular expression; a malformed one is a `QueryError` worth showing. */
export function compileQuery(q: CodeQuery): RegExp {
  let source = q.regex ? q.text : escape(q.text)
  if (q.wholeWord) source = `(?<![\\w$])(?:${source})(?![\\w$])`
  try {
    return new RegExp(source, `g${q.caseSensitive ? '' : 'i'}m`)
  } catch (e) {
    throw new QueryError(`Not a valid regular expression: ${e instanceof Error ? e.message : e}`)
  }
}

/** How much of a long line is kept around a match. */
const SNIPPET = 240

function snippet(line: string, column: number): { text: string; column: number } {
  if (line.length <= SNIPPET) return { text: line, column }
  const start = Math.max(0, Math.min(column - 60, line.length - SNIPPET))
  const cut = line.slice(start, start + SNIPPET)
  const lead = start > 0 ? '…' : ''
  return {
    text: `${lead}${cut}${start + SNIPPET < line.length ? '…' : ''}`,
    column: column - start + lead.length,
  }
}

/** Where each line starts, for turning an offset into a line number without splitting. */
export function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

/** The 0-based line an offset is on. */
export function lineOf(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * The matches in a text, one per line at most — a line is what a person opens — up to `limit`.
 * A regex that matches the empty string moves on rather than looping.
 */
export function searchText(text: string, re: RegExp, limit = Infinity): LineMatch[] {
  const out: LineMatch[] = []
  if (limit <= 0) return out
  re.lastIndex = 0
  let starts: number[] | null = null
  let lastLine = -1
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++
      if (re.lastIndex > text.length) break
      continue
    }
    starts ??= lineStarts(text)
    const line = lineOf(starts, m.index)
    if (line === lastLine) continue
    lastLine = line
    const from = starts[line]
    const end = line + 1 < starts.length ? starts[line + 1] - 1 : text.length
    const lineText = text.slice(from, end).replace(/\r$/, '')
    const column = m.index - from
    const cut = snippet(lineText, column)
    out.push({ line: line + 1, column: cut.column, length: m[0].length, text: cut.text })
    if (out.length >= limit) break
    // Straight on to the next line: the rest of this one is already reported.
    re.lastIndex = Math.max(re.lastIndex, end)
  }
  return out
}

/** Every match's offsets, for highlighting; not one per line. */
export function matchRanges(text: string, re: RegExp, limit = 10_000): Array<[number, number]> {
  const out: Array<[number, number]> = []
  re.lastIndex = 0
  for (let m = re.exec(text); m && out.length < limit; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++
      if (re.lastIndex > text.length) break
      continue
    }
    out.push([m.index, m.index + m[0].length])
  }
  return out
}

/**
 * A path glob as a test. `*` stays within a folder, `**` crosses them, `?` is one character,
 * `{a,b}` either. A glob without a slash is matched against the file's name wherever it is,
 * the way `*.ts` is usually meant. Several can be given, separated by commas or spaces.
 */
export function globMatcher(glob: string | undefined): (path: string) => boolean {
  const parts = (glob ?? '')
    .split(/[\s,]+(?![^{]*\})/)
    .map((g) => g.trim())
    .filter(Boolean)
  if (parts.length === 0) return () => true
  const tests = parts.map((g) => {
    const re = globToRegExp(g.replace(/^\.?\//, ''))
    return g.includes('/') ? (p: string) => re.test(p) : (p: string) => re.test(basename(p))
  })
  return (path) => tests.some((t) => t(path))
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function globToRegExp(glob: string): RegExp {
  let out = ''
  let inBraces = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` is any number of folders, none included.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else if (c === '{') {
      inBraces++
      out += '(?:'
    } else if (c === '}' && inBraces) {
      inBraces--
      out += ')'
    } else if (c === ',' && inBraces) out += '|'
    else out += escape(c)
  }
  return new RegExp(`^${out}$`)
}
