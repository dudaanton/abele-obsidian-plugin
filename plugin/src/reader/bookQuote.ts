/**
 * Words an agent quotes, found again in a page of a book — the ranges a highlight can be made of.
 *
 * An agent copies words out of `book_read` or `book_search`, which give the text plain, with the
 * page's spacing gone and its blocks on lines of their own; it may also retype a curly quote as a
 * straight one. So the words are compared with every space left out, case folded, quotes and
 * dashes of every kind taken as one, and soft hyphens and zero-width marks ignored. Nothing else is
 * forgiven: a word changed is a quote not found, which is what the agent must be told.
 *
 * It works on any page document the reader draws — a chapter of a book, or a PDF page's text
 * layer, whose spans run words of one line together — so the range it finds is the range a
 * person's selection of the same words would make there, and its CFI is the same.
 */

/** Characters that never count: spaces of every kind, soft hyphens, zero-width marks. */
const SKIP_CLASS = '[\\s\\u00AD\\u200B-\\u200D\\u2060\\uFEFF]'
const SKIP = new RegExp(SKIP_CLASS)
const SKIP_ALL = new RegExp(SKIP_CLASS, 'g')

const FOLD: Record<string, string> = {}
for (const c of '‘’‚‛′ʼ`´') FOLD[c] = "'"
for (const c of '“”„‟″«»') FOLD[c] = '"'
for (const c of '‐‑‒–—―−') FOLD[c] = '-'
FOLD['…'] = '...'

/** One character as it is compared: nothing, or its folded form. */
function fold(c: string): string {
  if (SKIP.test(c)) return ''
  const known = FOLD[c]
  if (known) return known
  return c.normalize('NFKC').toLowerCase().replace(SKIP_ALL, '')
}

/** The words as they are compared. */
export function quoteKey(text: string): string {
  let out = ''
  for (const c of text) out += fold(c)
  return out
}

/** Fewer folded characters than this could be anywhere: not a quote. */
export const MIN_QUOTE = 3

const UNREAD = /^(script|style|head|template|noscript|title)$/i

/** The page's text as compared, and for each character of it, where it is in the page. */
interface PageIndex {
  key: string
  at: { node: Text; start: number; end: number }[]
}

function indexOf(doc: Document): PageIndex {
  const at: PageIndex['at'] = []
  let key = ''
  const visit = (node: Node) => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      const text = node as Text
      const value = text.nodeValue ?? ''
      let i = 0
      for (const c of value) {
        const folded = fold(c)
        for (let k = 0; k < folded.length; k++) at.push({ node: text, start: i, end: i + c.length })
        key += folded
        i += c.length
      }
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    if (el.hasAttribute('hidden') || UNREAD.test(el.localName)) return
    for (const child of Array.from(el.childNodes)) visit(child)
  }
  visit(doc.body ?? doc.documentElement)
  return { key, at }
}

/**
 * Every place in the page the words are, in the page's order, up to `max`; none when the words
 * are too short to tell apart.
 */
export function findQuote(doc: Document, quote: string, max = 50): Range[] {
  const wanted = quoteKey(quote)
  if (wanted.length < MIN_QUOTE) return []
  const { key, at } = indexOf(doc)
  const out: Range[] = []
  for (let i = key.indexOf(wanted); i >= 0 && out.length < max; i = key.indexOf(wanted, i + 1)) {
    const first = at[i]
    const last = at[i + wanted.length - 1]
    const range = doc.createRange()
    range.setStart(first.node, first.start)
    range.setEnd(last.node, last.end)
    out.push(range)
  }
  return out
}

/**
 * Of the places found, the one a place given means: the one it falls in, else the closest to it,
 * counted in characters of text.
 */
export function nearest(found: Range[], place: Range): Range | null {
  if (!found.length) return null
  const doc = place.startContainer.ownerDocument ?? (place.startContainer as Document)
  const between = (a: Node, ao: number, b: Node, bo: number) => {
    const r = doc.createRange()
    r.setStart(a, ao)
    r.setEnd(b, bo)
    return quoteKey(r.toString()).length
  }
  let best: Range | null = null
  let bestDistance = Infinity
  for (const r of found) {
    const startsAfter = r.compareBoundaryPoints(Range.START_TO_START, place) > 0
    const endsBefore = r.compareBoundaryPoints(Range.START_TO_END, place) < 0
    if (!startsAfter && !endsBefore) return r
    const distance = startsAfter
      ? between(place.startContainer, place.startOffset, r.startContainer, r.startOffset)
      : between(r.endContainer, r.endOffset, place.startContainer, place.startOffset)
    if (distance < bestDistance) {
      best = r
      bestDistance = distance
    }
  }
  return best
}

const BLOCK =
  /^(p|div|h[1-6]|li|blockquote|pre|tr|dt|dd|figcaption|section|article|aside|br|hr|table|td|th)$/i

/**
 * The words of a range as a highlight keeps them: the page's spacing made single, a line where one
 * block ends and the next begins.
 */
export function wordsOf(range: Range): string {
  const root = range.commonAncestorContainer
  if (root.nodeType === 3) return tidy(range.toString())
  const doc = root.ownerDocument ?? (root as Document)
  let out = ''
  const walker = doc.createTreeWalker(root, 1 | 4)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue
    if (node.nodeType === 1) {
      if (BLOCK.test((node as Element).localName)) out += '\n'
      continue
    }
    const value = node.nodeValue ?? ''
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : value.length
    out += value.slice(start, end)
  }
  return tidy(out)
}

/** The block a boundary of a range sits in: its paragraph, else the page. */
function blockOf(node: Node): Node {
  const doc = node.ownerDocument ?? (node as Document)
  for (let at: Node | null = node; at; at = at.parentNode) {
    if (
      at.nodeType === 1 &&
      BLOCK.test((at as Element).localName) &&
      !/^(br|hr)$/i.test((at as Element).localName)
    )
      return at
  }
  return doc.body ?? doc.documentElement
}

/**
 * A find with the words of its paragraph on either side — what tells two finds of the same words
 * apart. A find running over paragraphs takes the text before it from the first and after it
 * from the last.
 */
export function aroundOf(range: Range): { pre: string; match: string; post: string } {
  const doc = range.startContainer.ownerDocument ?? (range.startContainer as Document)
  const before = doc.createRange()
  before.selectNodeContents(blockOf(range.startContainer))
  before.setEnd(range.startContainer, range.startOffset)
  const after = doc.createRange()
  after.selectNodeContents(blockOf(range.endContainer))
  after.setStart(range.endContainer, range.endOffset)
  return { pre: before.toString(), match: wordsOf(range), post: after.toString() }
}

const tidy = (text: string) =>
  text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim()
