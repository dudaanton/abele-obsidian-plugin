// The colours of code in a comparison: the same parser and the same highlighting the plugin's
// code view uses, run once over each whole version, so a line inside a comment or a string that
// started above it is coloured as one. Pure, apart from the stylesheet the colours need.
import { defaultHighlightStyle } from '@codemirror/language'
import { highlightTree } from '@lezer/highlight'
import { StyleModule } from 'style-mod'
import { languageOf } from '@/github/languages'
import type { DiffPiece } from './diffModel'

/**
 * Past this many characters a version is drawn plain: the code view parses only what is on
 * screen, a comparison parses the whole text at once, while it draws.
 */
export const MAX_HIGHLIGHTED = 500_000

/** A coloured stretch of one line, by its offsets in that line. */
export interface LineToken {
  from: number
  to: number
  cls: string
}

/** A piece of a line split where its colours change; `cls` is absent on plain text. */
export interface PaintedPiece extends DiffPiece {
  parts: { text: string; cls?: string }[]
}

/** Each line's coloured stretches; null when the file is not code we colour, or too large. */
export function lineTokens(text: string, path: string | undefined): LineToken[][] | null {
  if (!path || text.length > MAX_HIGHLIGHTED) return null
  const language = languageOf(path)
  if (!language) return null
  const starts = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  const out: LineToken[][] = starts.map((): LineToken[] => [])
  let line = 0
  highlightTree(language.parser.parse(text), defaultHighlightStyle, (from, to, cls) => {
    // A token over several lines — a block comment, a template string — is cut at each line end.
    while (from < to) {
      while (line + 1 < starts.length && starts[line + 1] <= from) line++
      const next = line + 1 < starts.length ? starts[line + 1] : Infinity
      const end = Math.min(to, next - 1)
      if (end > from) out[line].push({ from: from - starts[line], to: end - starts[line], cls })
      if (to < next) break
      from = next
    }
  })
  return out
}

/** A line's pieces with its colours laid inside them, so a changed word keeps its mark. */
export function paint(pieces: DiffPiece[], tokens: LineToken[] = []): PaintedPiece[] {
  let at = 0
  let t = 0
  return pieces.map((piece) => {
    const start = at
    const end = (at += piece.text.length)
    const parts: PaintedPiece['parts'] = []
    let pos = start
    while (t < tokens.length && tokens[t].to <= start) t++
    for (let i = t; i < tokens.length && tokens[i].from < end; i++) {
      const from = Math.max(tokens[i].from, start)
      const to = Math.min(tokens[i].to, end)
      if (from > pos) parts.push({ text: piece.text.slice(pos - start, from - start) })
      parts.push({ text: piece.text.slice(from - start, to - start), cls: tokens[i].cls })
      pos = to
    }
    if (pos < end) parts.push({ text: piece.text.slice(pos - start) })
    return { ...piece, parts }
  })
}

/** The highlight style's rules, in the document — or pop-out window — the comparison is in. */
export function mountSyntaxStyles(doc: Document): void {
  if (defaultHighlightStyle.module) StyleModule.mount(doc, defaultHighlightStyle.module)
}
