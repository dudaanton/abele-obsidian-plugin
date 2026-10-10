// The lines of a comparison, the way Obsidian's own diff shows them in file recovery and sync
// history: removed lines, added lines and the words that changed inside them, with long runs of
// unchanged lines folded away. Pure, so the view only draws it.
import { diff, presentableDiff } from '@codemirror/merge'

export interface DiffPiece {
  text: string
  /** This stretch differs from the other side; the line around it only moved with it. */
  changed: boolean
}

export interface DiffLine {
  kind: 'same' | 'removed' | 'added'
  pieces: DiffPiece[]
  /** 1-based line number in the old text, for removed and unchanged lines. */
  lineA?: number
  /** 1-based line number in the new text, for added and unchanged lines. */
  lineB?: number
}

/** Unchanged lines folded away, shown again on request. */
export interface DiffFold {
  kind: 'fold'
  lines: DiffLine[]
}

export type DiffRow = DiffLine | DiffFold

/** A removed line and the added one that took its place, side by side. Either may be absent. */
export interface DiffPair {
  kind: 'same' | 'change' | 'fold'
  left?: DiffLine
  right?: DiffLine
  lines?: DiffLine[]
}

/**
 * The lines of the two texts compared as wholes: each distinct line becomes one character, so the
 * string diff below runs over lines and an unchanged line is never split across a change.
 */
function lineChanges(a: string[], b: string[]) {
  const codes = new Map<string, string>()
  const encode = (lines: string[]) =>
    lines
      .map((line) => {
        let code = codes.get(line)
        if (code === undefined) {
          code = String.fromCodePoint(0xe000 + codes.size)
          codes.set(line, code)
        }
        return code
      })
      .join('')
  const ea = encode(a)
  const eb = encode(b)
  // Positions count UTF-16 units; the private-use codes above 0xFFFF take two.
  const index = (encoded: string, at: number) => [...encoded.slice(0, at)].length
  return diff(ea, eb).map((c) => ({
    fromA: index(ea, c.fromA),
    toA: index(ea, c.toA),
    fromB: index(eb, c.fromB),
    toB: index(eb, c.toB),
  }))
}

const isWord = (ch: string) => /[\p{L}\p{N}_]/u.test(ch)

/** Widens each changed range to whole words, so «Спрашивать» is marked whole, not «Спрашива». */
function wholeWords(text: string, ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (let [from, to] of ranges) {
    // Nothing removed or added on this side: there is nothing here to mark.
    if (from === to) continue
    while (from > 0 && isWord(text[from - 1]) && isWord(text[from])) from--
    while (to < text.length && isWord(text[to]) && isWord(text[to - 1])) to++
    const last = out.at(-1)
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else out.push([from, to])
  }
  return out
}

/** Cuts the lines of a block into pieces, marking the parts inside `ranges` (block offsets). */
function piecesOf(
  lines: string[],
  ranges: [number, number][],
  kind: 'removed' | 'added',
  firstLine: number
): DiffLine[] {
  let offset = 0
  return lines.map((text, i) => {
    const from = offset
    const to = offset + text.length
    offset = to + 1
    const pieces: DiffPiece[] = []
    let at = from
    for (const [start, end] of ranges) {
      const s = Math.max(start, from)
      const e = Math.min(end, to)
      if (e <= s) continue
      if (s > at) pieces.push({ text: text.slice(at - from, s - from), changed: false })
      pieces.push({ text: text.slice(s - from, e - from), changed: true })
      at = e
    }
    if (at < to || !pieces.length) pieces.push({ text: text.slice(at - from), changed: false })
    const line = firstLine + i
    return { kind, pieces, ...(kind === 'removed' ? { lineA: line } : { lineB: line }) }
  })
}

/** Every line of both texts in reading order: unchanged, then each change's removed and added. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  const same = (untilA: number) => {
    for (; i < untilA; i++, j++)
      out.push({
        kind: 'same',
        pieces: [{ text: a[i], changed: false }],
        lineA: i + 1,
        lineB: j + 1,
      })
  }
  for (const change of lineChanges(a, b)) {
    same(change.fromA)
    const removed = a.slice(change.fromA, change.toA)
    const added = b.slice(change.fromB, change.toB)
    // Words are compared only where lines were replaced; a line only added or only removed has
    // nothing to mark inside it, its colour already says it all.
    let rangesA: [number, number][] = []
    let rangesB: [number, number][] = []
    if (removed.length && added.length) {
      const textA = removed.join('\n')
      const textB = added.join('\n')
      const words = presentableDiff(textA, textB)
      rangesA = wholeWords(
        textA,
        words.map((w) => [w.fromA, w.toA] as [number, number])
      )
      rangesB = wholeWords(
        textB,
        words.map((w) => [w.fromB, w.toB] as [number, number])
      )
    }
    out.push(...piecesOf(removed, rangesA, 'removed', change.fromA + 1))
    out.push(...piecesOf(added, rangesB, 'added', change.fromB + 1))
    i = change.toA
    j = change.toB
  }
  same(a.length)
  return out
}

/**
 * Folds every run of unchanged lines longer than `context` lines on each side of a change, as
 * Obsidian collapses the parts of a file that did not change.
 */
export function foldUnchanged(lines: DiffLine[], context = 3): DiffRow[] {
  const out: DiffRow[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind !== 'same') {
      out.push(lines[i++])
      continue
    }
    let j = i
    while (j < lines.length && lines[j].kind === 'same') j++
    const run = lines.slice(i, j)
    const keepBefore = i === 0 ? 0 : context
    const keepAfter = j === lines.length ? 0 : context
    if (run.length > keepBefore + keepAfter + 1) {
      out.push(...run.slice(0, keepBefore))
      out.push({ kind: 'fold', lines: run.slice(keepBefore, run.length - keepAfter) })
      out.push(...run.slice(run.length - keepAfter))
    } else out.push(...run)
    i = j
  }
  return out
}

/** The same rows, with each removed line set beside the added line that replaced it. */
export function pairRows(rows: DiffRow[]): DiffPair[] {
  const out: DiffPair[] = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]
    if (row.kind === 'fold') {
      out.push({ kind: 'fold', lines: row.lines })
      i++
    } else if (row.kind === 'same') {
      out.push({ kind: 'same', left: row, right: row })
      i++
    } else {
      const removed: DiffLine[] = []
      const added: DiffLine[] = []
      while (i < rows.length && rows[i].kind === 'removed') removed.push(rows[i++] as DiffLine)
      while (i < rows.length && rows[i].kind === 'added') added.push(rows[i++] as DiffLine)
      for (let k = 0; k < Math.max(removed.length, added.length); k++)
        out.push({ kind: 'change', left: removed[k], right: added[k] })
    }
  }
  return out
}
