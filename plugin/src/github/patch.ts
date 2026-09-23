/**
 * A unified diff, as GitHub hands it per file in `patch`, split into numbered lines.
 *
 * Each line carries the number it has on each side — the old file's for a removed line, the new
 * file's for an added one, both for context — because that is what a `#diff-…R42` anchor names
 * and what the gutter shows.
 */

export type DiffLineType = 'hunk' | 'add' | 'del' | 'ctx' | 'note'

export interface DiffLine {
  type: DiffLineType
  /** The line without its leading `+`, `-` or space. A hunk header is kept whole. */
  text: string
  old?: number
  new?: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const raw of patch.split('\n')) {
    const hunk = HUNK.exec(raw)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      out.push({ type: 'hunk', text: raw })
      continue
    }
    // Before the first hunk there is nothing to number; GitHub sends none, but be safe.
    if (out.length === 0) continue

    const sign = raw[0]
    const text = raw.slice(1)
    if (sign === '+') out.push({ type: 'add', text, new: newLine++ })
    else if (sign === '-') out.push({ type: 'del', text, old: oldLine++ })
    else if (sign === '\\') out.push({ type: 'note', text: raw })
    else out.push({ type: 'ctx', text, old: oldLine++, new: newLine++ })
  }

  // A patch ending in a newline leaves one empty context line that is not in either file.
  const last = out[out.length - 1]
  if (last && last.type === 'ctx' && last.text === '' && patch.endsWith('\n')) out.pop()
  return out
}

/**
 * The indexes (0-based, into `lines`) that an anchor points at: `R` counts on the new side, `L` on
 * the old. Empty when the range is outside what the patch shows — GitHub folds unchanged code
 * away, and a link can point into a fold.
 */
export function linesFor(lines: DiffLine[], side: 'L' | 'R', start: number, end = start): number[] {
  const out: number[] = []
  lines.forEach((line, i) => {
    const n = side === 'R' ? line.new : line.old
    if (n !== undefined && n >= start && n <= end) out.push(i)
  })
  return out
}
