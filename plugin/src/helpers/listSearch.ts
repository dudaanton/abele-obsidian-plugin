/**
 * Matching for the search in the task, log and transaction lists: a query is a handful of words,
 * and an entry matches when its text holds every one of them, in any order and any case.
 */

/** The words a query is made of, lowercased. A blank query has none. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/** Whether already lowercased text holds every word. No words match everything. */
export function matchesTerms(text: string, terms: readonly string[]): boolean {
  return terms.every((term) => text.includes(term))
}

/** Elements whose text is not read on screen. */
const SKIPPED = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'NOSCRIPT'])

/**
 * A range for every place a word appears in the text under `root`, for marking the words in
 * what the list shows. Text is looked at node by node, so a word split by markup — half of it
 * bold — is not found; that is the price of never touching the rendered markdown itself.
 */
export function findTextRanges(root: Node, terms: readonly string[]): Range[] {
  if (!terms.length) return []
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const ranges: Range[] = []

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement && SKIPPED.has(node.parentElement.tagName)) continue
    const text = node.nodeValue ?? ''
    const lower = text.toLowerCase()
    // A few letters change length when lowercased; offsets in the copy would then point at
    // the wrong characters of the original, so such a node is left unmarked.
    if (lower.length !== text.length) continue

    for (const term of terms) {
      for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) {
        const range = doc.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + term.length)
        ranges.push(range)
      }
    }
  }

  // In reading order, so overlapping words from two terms still mark left to right.
  return ranges.sort((a, b) => a.compareBoundaryPoints(0 /* START_TO_START */, b))
}
