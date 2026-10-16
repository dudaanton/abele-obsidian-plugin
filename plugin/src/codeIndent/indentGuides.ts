/**
 * Indent guides in a code block: how many levels deep each line stands, so a faint line can be
 * drawn at each. Pure: lines in, depths out. The step is read from the block itself (the common
 * measure of its indents), and falls back to the tab size when nothing is indented.
 */

/** The leading run of a line in columns, or null when tabs and spaces are mixed in it. */
export function leadingWidth(line: string, tabSize: number): number | null {
  const lead = /^[\t ]*/.exec(line)[0]
  if (lead.includes('\t') && lead.includes(' ')) return null
  return lead.includes('\t') ? lead.length * tabSize : lead.length
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/** The block's own indent step, in columns. */
export function indentStep(lines: readonly string[], tabSize: number): number {
  let step = 0
  for (const line of lines) {
    if (!line.trim()) continue
    const width = leadingWidth(line, tabSize)
    if (width) step = gcd(step, width)
  }
  // One stray space of alignment would make every column a level; such a block gets the tab size.
  return step >= 2 ? step : tabSize
}

/**
 * Levels per line. A blank line inside an indented region keeps the guides that run past it, the
 * lesser of the lines around it; a line whose indent mixes tabs and spaces gets none.
 */
export function guideDepths(lines: readonly string[], tabSize: number): number[] {
  const step = indentStep(lines, tabSize)
  const own = lines.map((line) => {
    if (!line.trim()) return undefined
    const width = leadingWidth(line, tabSize)
    return width === null ? 0 : Math.floor(width / step)
  })
  const depths = own.map((d) => d ?? 0)
  let before = 0
  for (let i = 0; i < lines.length; i++) {
    if (own[i] !== undefined) {
      before = own[i]
      continue
    }
    let after = i
    while (after < lines.length && own[after] === undefined) after++
    const depth = after >= lines.length ? 0 : Math.min(before, own[after])
    // Fill the whole blank run once, rather than searching both ends for every blank.
    for (; i < after; i++) depths[i] = depth
    i--
  }
  return depths
}
