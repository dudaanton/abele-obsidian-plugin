/**
 * The text side of a mermaid block: where the blocks are in a note, and what is handed to
 * Mermaid to draw one in the current theme.
 */

export interface MermaidFence {
  /** The opening fence's line, 0-based. */
  startLine: number
  /** The closing fence's line. */
  endLine: number
  source: string
}

const OPEN = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)/

/**
 * Every closed ```mermaid block in a note, in the order they appear.
 *
 * Only blocks at the top level of the note: one inside a quote or a callout is drawn by
 * Obsidian as rendered markdown, which the reading-view processor already reaches. A block
 * with no closing fence yet is left alone — it is being typed, and drawing half of it would
 * only flash errors at the person typing.
 */
export function findMermaidFences(lines: string[]): MermaidFence[] {
  const fences: MermaidFence[] = []
  let i = 0
  while (i < lines.length) {
    const open = OPEN.exec(lines[i])
    if (!open) {
      i++
      continue
    }
    const [, indent, marker, language] = open
    const close = new RegExp(`^[ \\t]*${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`)
    let end = i + 1
    while (end < lines.length && !close.test(lines[end])) end++
    if (end >= lines.length) {
      // Unclosed: Markdown runs it to the end of the note, so nothing after it is a block.
      break
    }
    if (language.toLowerCase() === 'mermaid') {
      const body = lines
        .slice(i + 1, end)
        .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()))
      fences.push({ startLine: i, endLine: end, source: body.join('\n') })
    }
    i = end + 1
  }
  return fences
}

export type DiagramTheme = 'light' | 'dark'

const FRONT_MATTER = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(\n|$)/

/**
 * The source with a request for Mermaid's theme matching Obsidian's.
 *
 * Mermaid is Obsidian's, initialised once for the whole app, so changing its configuration
 * would change every diagram Obsidian draws itself. A directive at the top of the text applies
 * to that one render and is gone by the next. A diagram that chooses its own theme keeps it.
 */
export function withTheme(source: string, theme: DiagramTheme): string {
  const front = FRONT_MATTER.exec(source)
  const head = front ? front[0] : ''
  if (/%%\{\s*init/i.test(source) || /^\s*theme\s*:/m.test(head)) return source
  const directive = `%%{init: {"theme": "${theme === 'dark' ? 'dark' : 'default'}"}}%%\n`
  return head + directive + source.slice(head.length)
}
