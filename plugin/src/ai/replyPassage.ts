/** The host renders markdown; the core only compares strings and source ranges. */
export type ReplyTextRenderer = (source: string) => Promise<string>

/**
 * Verify source candidates against the actual renderer, not a guessed markdown-to-text map.
 * Replacing the candidate with a neutral marker must replace exactly the selected rendered
 * words and nothing else. This disambiguates repeated prose and ignores hidden link targets.
 * Balanced inline delimiters may be included; complex or partial syntax fails closed.
 */
export async function resolveReplyPassage(
  source: string,
  quote: string,
  start: number,
  render: ReplyTextRenderer
): Promise<{ from: number; old: string }> {
  const shown = await render(source)
  if (!quote || !Number.isInteger(start) || start < 0 || !shown.startsWith(quote, start))
    throw new Error('The selected passage changed. Select it again and start a new comment.')
  let marker = 'abelepassageboundary'
  while (source.includes(marker) || shown.includes(marker)) marker += 'x'
  const expected = shown.slice(0, start) + marker + shown.slice(start + quote.length)
  const candidates = new Map<string, { from: number; to: number }>()
  const add = (from: number, to: number) => candidates.set(`${from}:${to}`, { from, to })
  const occurrences = (word: string): number[] => {
    const found: number[] = []
    for (
      let at = source.indexOf(word);
      at >= 0 && found.length < 64;
      at = source.indexOf(word, at + 1)
    )
      found.push(at)
    return found
  }
  for (const from of occurrences(quote)) add(from, from + quote.length)
  const words = quote.match(/[\p{L}\p{N}]+/gu)
  if (words?.length) {
    const first = words[0],
      last = words.at(-1)!
    const leading = quote.slice(0, quote.indexOf(first))
    const trailing = quote.slice(quote.lastIndexOf(last) + last.length)
    for (const from of occurrences(first)) {
      for (const end of occurrences(last)) {
        const to = end + last.length
        if (to <= from || to - from > quote.length * 4 + 200) continue
        // Punctuation belongs to the selection too. Delimiters may lie between it and
        // the edge word, so enumerate both, then let the renderer verify the exact range.
        let left = from,
          right = to
        const edgeChars = /[^\p{L}\p{N}\s]/u
        while (left > Math.max(0, from - leading.length - 4) && edgeChars.test(source[left - 1])) left--
        while (right < Math.min(source.length, to + trailing.length + 4) && edgeChars.test(source[right])) right++
        for (let a = from; a >= left; a--) for (let b = to; b <= right; b++) add(a, b)
      }
    }
  }
  let tried = 0
  for (const { from, to } of candidates.values()) {
    if (++tried > 64) break
    const marked = source.slice(0, from) + marker + source.slice(to)
    if ((await render(marked)) === expected) return { from, old: source.slice(from, to) }
  }
  throw new Error(
    'Cannot safely map this selection to its markdown. Select a complete passage or words within one formatting span and start a new comment.'
  )
}
