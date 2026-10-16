// The colours of code in a comparison: the same parser and the same highlighting the plugin's
// code view uses, run once over each whole version, so a line inside a comment or a string that
// started above it is coloured as one. Token classes take their colours from the host theme.
import { prism, loadedPrism, lineTokens as prismLineTokens } from './codeSyntax'
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
  return text.length <= MAX_HIGHLIGHTED && prism.value
    ? prismLineTokens(prism.value, text, path)
    : null
}
void loadedPrism().catch(console.debug)

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
