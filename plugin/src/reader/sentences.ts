/**
 * A page's text as sentences, each with the range it covers on the page: what reading aloud
 * speaks, one sentence at a time, and marks as it goes.
 *
 * Text is read block by block — a paragraph, a heading, a list item — so a sentence never runs
 * from one paragraph into the next, and split into sentences by the platform's own rules for the
 * book's language (`Intl.Segmenter`). What is hidden on the page is not read: notes that open in a
 * dialog, what the cleaning took out.
 */

export interface Sentence {
  text: string
  range: Range
}

const BLOCK =
  /^(p|div|h[1-6]|li|blockquote|pre|td|th|dt|dd|figcaption|caption|section|article|aside|header|footer|body|table|tr|ul|ol|dl|figure|nav|main)$/i
const SKIP = /^(script|style|head|title|noscript|template|svg|math|rt|rp)$/i

/** Whether an element and what is in it are left out: hidden, or not text at all. */
function hidden(el: Element): boolean {
  if (SKIP.test(el.localName)) return true
  if (el.hasAttribute('hidden') || el.hasAttribute('data-abele-removed')) return true
  if (el.getAttribute('aria-hidden') === 'true') return true
  const view = el.ownerDocument.defaultView
  if (!view) return false
  const style = view.getComputedStyle(el)
  return style.display === 'none' || style.visibility === 'hidden'
}

/** A block's text nodes, gathered in order; a line break inside it counts as a space. */
interface Piece {
  node: Text | null
  text: string
}

function blocks(root: Element): Piece[][] {
  const out: Piece[][] = []
  let current: Piece[] = []
  const flush = () => {
    if (current.some((p) => p.node && p.text.trim())) out.push(current)
    current = []
  }
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? ''
      if (text) current.push({ node: node as Text, text })
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    if (hidden(el)) return
    if (el.localName === 'br') {
      current.push({ node: null, text: ' ' })
      return
    }
    const block = BLOCK.test(el.localName)
    if (block) flush()
    for (const child of Array.from(el.childNodes)) visit(child)
    if (block) flush()
  }
  visit(root)
  flush()
  return out
}

/** Where a character of a block's joined text is on the page. */
function locate(
  pieces: Piece[],
  starts: number[],
  offset: number,
  end: boolean
): [Text, number] | null {
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]
    if (!p.node) continue
    const from = starts[i]
    const to = from + p.text.length
    if (end ? offset <= to && offset > from : offset >= from && offset < to)
      return [p.node, offset - from]
  }
  // Inside a line break: the next text node's start, or the last one's end.
  if (!end) {
    for (let i = 0; i < pieces.length; i++)
      if (pieces[i].node && starts[i] >= offset) return [pieces[i].node, 0]
  } else {
    for (let i = pieces.length - 1; i >= 0; i--)
      if (pieces[i].node && starts[i] + pieces[i].text.length <= offset)
        return [pieces[i].node, pieces[i].text.length]
  }
  return null
}

const WORDS = /[\p{L}\p{N}]/u

/**
 * Where one boundary point is against another — negative before, zero at, positive after — by
 * the DOM's own rule for ranges, written out so it does not depend on `Range` comparisons.
 */
function comparePoints(a: Node, aOffset: number, b: Node, bOffset: number): number {
  if (a === b) return Math.sign(aOffset - bOffset)
  const position = a.compareDocumentPosition(b)
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return -comparePoints(b, bOffset, a, aOffset)
  if (position & Node.DOCUMENT_POSITION_CONTAINED_BY) {
    let child: Node = b
    while (child.parentNode && child.parentNode !== a) child = child.parentNode
    const index = Array.prototype.indexOf.call(a.childNodes, child) as number
    return index < aOffset ? 1 : -1
  }
  return -1
}

/** The page's sentences, from `from` on when given (the sentence it falls in included). */
export function sentencesIn(doc: Document, lang: string, from?: Range | null): Sentence[] {
  const root = doc.body ?? doc.documentElement
  if (!root) return []
  let segmenter: Intl.Segmenter
  try {
    segmenter = new Intl.Segmenter(lang || 'en', { granularity: 'sentence' })
  } catch {
    segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
  }
  const out: Sentence[] = []
  for (const pieces of blocks(root)) {
    const starts: number[] = []
    let joined = ''
    for (const p of pieces) {
      starts.push(joined.length)
      joined += p.text
    }
    for (const { index, segment } of segmenter.segment(joined)) {
      const text = segment.replace(/\s+/g, ' ').trim()
      if (!WORDS.test(text)) continue
      const lead = segment.length - segment.trimStart().length
      const trail = segment.length - segment.trimEnd().length
      const a = locate(pieces, starts, index + lead, false)
      const b = locate(pieces, starts, index + segment.length - trail, true)
      if (!a || !b) continue
      const range = doc.createRange()
      try {
        range.setStart(a[0], a[1])
        range.setEnd(b[0], b[1])
      } catch {
        continue
      }
      // Left out when it ends before `from` starts. `from` may be the whole page on screen: what
      // counts is where it starts, never where it ends.
      if (from && comparePoints(b[0], b[1], from.startContainer, from.startOffset) <= 0) continue
      out.push({ text, range })
    }
  }
  return out
}
