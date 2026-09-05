/**
 * A line diff, for the version history.
 *
 * Two versions of a note are two strings, and what a person wants to see is which lines
 * changed — so this is the classic longest-common-subsequence over lines, rendered as a
 * unified diff. The common head and tail are taken off first, which is what keeps the table
 * small on the usual case of one edit in a long note; a pair with nothing in common and no
 * shared ends still falls back to "all of it went, all of it arrived" rather than filling
 * memory with a table nobody reads.
 *
 * The daemon's `history --diff` prints the same diff from the same algorithm, and this is that
 * file copied rather than imported: `@abele/sync-core` is the engine two hosts share, and how
 * a host draws a change for a person to read is not part of it. A fix to one belongs in both.
 *
 * Which is also why the fourteen `!` assertions below are still here. The daemon compiles under
 * `strict`, where indexing a `string[]` or an `Int32Array` yields `T | undefined` and every one
 * of them is load-bearing; this plugin does not, so ESLint reports each as unnecessary. They are
 * kept for parity: the two files are meant to diff cleanly against each other, and fourteen
 * cosmetic deletions would bury the next real change to the algorithm in noise.
 */

/** One line's fate: kept, taken away, or brought in. */
export type Sign = ' ' | '-' | '+'

/** One line of one of the texts, and what became of it. */
export interface Change {
  sign: Sign
  text: string
}

export interface DiffLabels {
  from: string
  to: string
}

/** How many unchanged lines a hunk carries on each side. */
const CONTEXT = 3
/** The largest table this will build; a bigger pair is reported as a wholesale replacement. */
const MAX_CELLS = 4_000_000

/**
 * The lines of a text, without the empty one a trailing newline leaves behind: a file ending
 * in `\n` is the same lines as one that does not, and diffing them would otherwise show a
 * change nobody made. An empty file is no lines at all, so a version that was empty diffs as
 * `-0,0` rather than as a blank line somebody took away.
 */
export function toLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * A unified diff of two texts, line by line, as the lines to print. Empty when they are the
 * same, so a caller can say "no difference" in its own words.
 */
export function unifiedDiff(before: string, after: string, labels: DiffLabels): string[] {
  const changes = diffLines(toLines(before), toLines(after))
  if (!changes.some((change) => change.sign !== ' ')) return []
  const hunks = hunksOf(changes)
  return [`--- ${labels.from}`, `+++ ${labels.to}`, ...hunks]
}

/** Every line of both texts, in order, each marked with what became of it. */
export function diffLines(before: string[], after: string[]): Change[] {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++
  }

  const middleBefore = before.slice(head, before.length - tail)
  const middleAfter = after.slice(head, after.length - tail)
  const changes: Change[] = []
  for (const text of before.slice(0, head)) changes.push({ sign: ' ', text })
  changes.push(...middle(middleBefore, middleAfter))
  for (const text of before.slice(before.length - tail)) changes.push({ sign: ' ', text })
  return changes
}

/** The part that actually differs: an LCS walk, or a plain replacement when it is too big. */
function middle(before: string[], after: string[]): Change[] {
  if (before.length === 0 || after.length === 0 || before.length * after.length > MAX_CELLS) {
    return [
      ...before.map((text): Change => ({ sign: '-', text })),
      ...after.map((text): Change => ({ sign: '+', text })),
    ]
  }

  // lcs[i][j] is the length of the longest common subsequence of before[i…] and after[j…],
  // filled from the end so the walk below runs forwards and keeps the lines in order.
  const width = after.length + 1
  const lcs = new Int32Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        before[i] === after[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!)
    }
  }

  const changes: Change[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      changes.push({ sign: ' ', text: before[i]! })
      i++
      j++
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      changes.push({ sign: '-', text: before[i]! })
      i++
    } else {
      changes.push({ sign: '+', text: after[j]! })
      j++
    }
  }
  for (; i < before.length; i++) changes.push({ sign: '-', text: before[i]! })
  for (; j < after.length; j++) changes.push({ sign: '+', text: after[j]! })
  return changes
}

/** The changed runs with their context, each under the `@@` header that places it. */
function hunksOf(changes: Change[]): string[] {
  const interesting = changes
    .map((change, index) => (change.sign === ' ' ? -1 : index))
    .filter((index) => index >= 0)

  const lines: string[] = []
  let cut = 0
  while (cut < interesting.length) {
    const first = interesting[cut]!
    let last = first
    let next = cut + 1
    // A run ends where the gap to the next change is wider than the context on both sides,
    // which is where a reader would rather see two hunks than one long one.
    while (next < interesting.length && interesting[next]! - last <= CONTEXT * 2 + 1) {
      last = interesting[next]!
      next++
    }
    const from = Math.max(0, first - CONTEXT)
    const to = Math.min(changes.length - 1, last + CONTEXT)
    lines.push(...renderHunk(changes, from, to))
    cut = next
  }
  return lines
}

/** One hunk: its header, then every line in it with its sign. */
function renderHunk(changes: Change[], from: number, to: number): string[] {
  let beforeStart = 1
  let afterStart = 1
  for (let index = 0; index < from; index++) {
    const sign = changes[index]!.sign
    if (sign !== '+') beforeStart++
    if (sign !== '-') afterStart++
  }
  let beforeCount = 0
  let afterCount = 0
  const body: string[] = []
  for (let index = from; index <= to; index++) {
    const { sign, text } = changes[index]!
    if (sign !== '+') beforeCount++
    if (sign !== '-') afterCount++
    body.push(`${sign}${text}`)
  }
  // An empty side counts from 0, the way diff writes a pure addition or a pure deletion.
  const head = `-${beforeCount === 0 ? 0 : beforeStart},${beforeCount}`
  const tail = `+${afterCount === 0 ? 0 : afterStart},${afterCount}`
  return [`@@ ${head} ${tail} @@`, ...body]
}
