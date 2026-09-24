/**
 * Code from GitHub, or a comment, kept in a note as a fenced block the plugin draws as a card.
 *
 *     ```abele-github
 *     url: https://github.com/acme/widgets/pull/42/files#diff-<hash>R10-R12
 *     label: acme/widgets#42 · src/app.ts:10–12
 *     lang: ts
 *     diff: true
 *     ---
 *     @@ -10 +10 @@
 *     -old line
 *     +new line
 *     ```
 *
 * Everything the card shows is in the block, so it reads offline and stays what it was when it
 * was taken, whatever happens to the repository since. `url` is the same address a copied link
 * has, and opens the place in a GitHub tab.
 *
 * - Lines of a file: `start:` is the number of the first line.
 * - Lines of a diff: `diff: true`, and the text is unified-diff lines — ` `, `-`, `+` — under an
 *   `@@ -old +new @@` header that carries the numbers of both sides.
 * - A comment: `comment: true`, and the text is a line naming who wrote it and when, then the
 *   comment's markdown.
 */
import { formatDate } from './format'
import type { DiffLine } from './patch'
import type { GithubLink, LineSpan } from './permalinks'

export const SNIPPET_BLOCK = 'abele-github'

export interface SnippetBlock {
  url: string
  label: string
  kind: 'code' | 'diff' | 'comment'
  /** The file's extension, which picks the highlighting. */
  lang?: string
  /** Lines of a file: the number the first one has. */
  start?: number
  text: string
}

/** A file's extension, for `lang`. */
export function languageOf(path: string): string | undefined {
  const name = path.split('/').pop() ?? path
  return name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() || undefined : undefined
}

/** Lines `span.from`–`span.to` (1-based) of a file's text. */
export function codeSnippet(
  link: GithubLink,
  path: string,
  text: string,
  span: LineSpan
): SnippetBlock {
  const lines = text.split('\n').slice(span.from - 1, span.to)
  return {
    ...link,
    kind: 'code',
    lang: languageOf(path),
    start: span.from,
    text: lines.join('\n'),
  }
}

const SIGN: Record<DiffLine['type'], string> = { add: '+', del: '-', ctx: ' ', hunk: '', note: '' }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * The number the line at `index` has, or would have, on one side: its own, else the next one
 * after it, else one past the last before it, else where its hunk starts on that side — which for
 * a new file's old side is 0.
 */
function numberAt(lines: DiffLine[], index: number, side: 'old' | 'new'): number {
  for (let i = index; i < lines.length && lines[i].type !== 'hunk'; i++) {
    const n = lines[i][side]
    if (n !== undefined) return n
  }
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.type === 'hunk') {
      const m = HUNK.exec(line.text)
      return m ? Number(side === 'old' ? m[1] : m[2]) : 1
    }
    const n = line[side]
    if (n !== undefined) return n + 1
  }
  return 1
}

/**
 * Lines `span.from`–`span.to` (1-based, as the diff view counts them: its hunk headers are lines
 * too) of a file's diff.
 */
export function diffSnippet(
  link: GithubLink,
  path: string,
  lines: DiffLine[],
  span: LineSpan
): SnippetBlock {
  const first = Math.max(0, span.from - 1)
  const picked = lines.slice(first, span.to)
  const out = picked.map((l) =>
    l.type === 'hunk' || l.type === 'note' ? l.text : SIGN[l.type] + l.text
  )
  if (picked[0]?.type !== 'hunk') {
    out.unshift(`@@ -${numberAt(lines, first, 'old')} +${numberAt(lines, first, 'new')} @@`)
  }
  return { ...link, kind: 'diff', lang: languageOf(path), text: out.join('\n') }
}

/** A comment, a review or an item's description, quoted with who wrote it and when. */
export function commentSnippet(
  link: GithubLink,
  comment: { author: string; createdAt?: string; body: string }
): SnippetBlock {
  const when = formatDate(comment.createdAt)
  const byline = when ? `**${comment.author}** · ${when}` : `**${comment.author}**`
  return { ...link, kind: 'comment', text: `${byline}\n\n${comment.body.trim()}` }
}

/** The block, fenced longer than any run of backticks in the text. */
export function formatSnippet(s: SnippetBlock): string {
  const longest = Math.max(0, ...(s.text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const oneLine = (v: string) => v.replace(/\s*\n\s*/g, ' ')
  const head = [`url: ${oneLine(s.url)}`, `label: ${oneLine(s.label)}`]
  if (s.lang) head.push(`lang: ${s.lang}`)
  if (s.kind === 'code' && s.start !== undefined) head.push(`start: ${s.start}`)
  if (s.kind === 'diff') head.push('diff: true')
  if (s.kind === 'comment') head.push('comment: true')
  return [`${fence}${SNIPPET_BLOCK}`, ...head, '---', s.text.replace(/\n+$/, ''), fence].join('\n')
}

/** Reads what is between the fences; null for a block without an address, a label or `---`. */
export function parseSnippet(source: string): SnippetBlock | null {
  const lines = source.split('\n')
  const fields: Record<string, string> = {}
  const sep = lines.findIndex((l) => l.trim() === '---')
  if (sep === -1) return null
  for (const line of lines.slice(0, sep)) {
    const m = /^(\w+):\s*(.*)$/.exec(line)
    if (m) fields[m[1]] = m[2].trim()
  }
  if (!fields.url || !fields.label) return null

  const kind = fields.diff === 'true' ? 'diff' : fields.comment === 'true' ? 'comment' : 'code'
  const start = /^\d+$/.test(fields.start ?? '') ? Number(fields.start) : undefined
  const snippet: SnippetBlock = { url: fields.url, label: fields.label, kind, text: '' }
  if (fields.lang) snippet.lang = fields.lang
  if (kind === 'code' && start !== undefined) snippet.start = start
  snippet.text = lines
    .slice(sep + 1)
    .join('\n')
    .replace(/\n+$/, '')
  return snippet
}
