/**
 * A chapter's text as one string, and the way back from a place in it to the page's own text
 * nodes — so words that run across `<em>` or `<span>` are one word, and a word found in the string
 * can be measured on the page.
 *
 * Text nodes are joined as they are: inside a paragraph, `<i>Ma</i>ja` is `Maja`. Between blocks —
 * paragraphs, list items, headings, cells — and at a line break or a picture a space is put in, so
 * the last word of one paragraph never runs into the first of the next. What is never read as
 * text is left out: scripts, styles, and the small annotations over ruby text.
 */

/** A chapter's text, and where each of its text nodes starts in it. */
export interface SectionText {
  text: string
  nodes: Text[]
  starts: number[]
  /** Each node's place in `nodes`, made the first time a point is looked up. */
  where?: Map<Text, number>
}

/** Elements whose start or end parts words. */
const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])
/** Elements that stand between words without holding any. */
const BREAK = new Set(['br', 'img', 'image', 'svg', 'hr', 'wbr', 'video', 'audio', 'math'])
/** Elements whose text is never read. */
const SKIP = new Set(['script', 'style', 'rt', 'rp', 'noscript', 'template', 'head', 'title'])
/** Pictures drawn in the page: their words are no text of the book, and they stand between words. */
const PICTURE = new Set(['svg', 'math'])

/** The chapter's text, walked once. */
export function sectionText(doc: Document): SectionText {
  const root = doc.body ?? doc.documentElement
  const out: SectionText = { text: '', nodes: [], starts: [] }
  if (!root) return out
  const parts: string[] = []
  let length = 0
  const blocks = new Map<Element, Element>()
  const blockOf = (el: Element | null): Element | null => {
    const trail: Element[] = []
    let found: Element | null = null
    for (let e = el; e; e = e.parentElement) {
      const known = blocks.get(e)
      if (known) {
        found = known
        break
      }
      trail.push(e)
      if (BLOCK.has(e.localName) || e === root) {
        found = e
        break
      }
    }
    for (const e of trail) if (found) blocks.set(e, found)
    return found
  }
  let gap = false
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node.nodeType !== 1) return NodeFilter.FILTER_ACCEPT
      const name = (node as Element).localName
      if (PICTURE.has(name)) gap = true
      return SKIP.has(name) || PICTURE.has(name)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })
  let lastBlock: Element | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) {
      if (BREAK.has((node as Element).localName)) gap = true
      continue
    }
    const value = (node as Text).data
    if (!value) continue
    const block = blockOf(node.parentElement)
    if ((gap || block !== lastBlock) && length) {
      parts.push(' ')
      length += 1
    }
    gap = false
    lastBlock = block
    out.nodes.push(node as Text)
    out.starts.push(length)
    parts.push(value)
    length += value.length
  }
  out.text = parts.join('')
  return out
}

/** The text node an offset of the text is in: the last one starting at or before it. */
function nodeAt(st: SectionText, offset: number): number {
  let lo = 0
  let hi = st.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (st.starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** A range over `[start, end)` of the text, on the page's own nodes; null past its end. */
export function rangeOf(st: SectionText, start: number, end: number): Range | null {
  if (!st.nodes.length) return null
  const a = nodeAt(st, start)
  // The end belongs to the node the last character is in.
  const b = nodeAt(st, Math.max(start, end - 1))
  const first = st.nodes[a]
  const last = st.nodes[b]
  const doc = first.ownerDocument
  if (!doc || !first.isConnected || !last.isConnected) return null
  const range = doc.createRange()
  try {
    range.setStart(first, Math.min(start - st.starts[a], first.data.length))
    range.setEnd(last, Math.min(end - st.starts[b], last.data.length))
  } catch {
    return null
  }
  return range
}

/**
 * Where a point of the page — a range's start or end — falls in the text: its offset, or the start
 * of the first text node after it when it is between nodes.
 */
export function offsetOf(st: SectionText, container: Node, offset: number): number {
  if (container.nodeType === 3) {
    st.where ??= new Map(st.nodes.map((n, i) => [n, i]))
    const i = st.where.get(container as Text) ?? -1
    if (i >= 0) return st.starts[i] + Math.min(offset, (container as Text).data.length)
  }
  const doc = container.ownerDocument ?? (container as Document)
  const point = doc.createRange()
  try {
    point.setStart(container, offset)
  } catch {
    return 0
  }
  // The first node whose start is at or after the point.
  let lo = 0
  let hi = st.nodes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    let after: number
    try {
      after = point.comparePoint(st.nodes[mid], 0)
    } catch {
      after = 1
    }
    if (after >= 0) hi = mid
    else lo = mid + 1
  }
  return lo < st.nodes.length ? st.starts[lo] : st.text.length
}
