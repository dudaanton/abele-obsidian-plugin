/**
 * How words some note links to are marked on the page: a dotted underline in the theme's accent —
 * neither a highlight's fill nor a discussion's solid line and bubble — which a tap on opens the
 * note.
 *
 * A link to the page as a whole (a link copied with nothing selected) names a range the size of a
 * page. Underlining all of it would dot every line, and a tap anywhere on the page would open the
 * note instead of turning it; such a place is marked by its first word only.
 */

/** The key of a link's mark among the engine's annotations; the place follows it. */
export const LINK_KEY = 'abele-link:'

/** Longer than this, a place is a page rather than words, and only its first word is marked. */
export const LONG_PLACE = 280

const SVG = 'http://www.w3.org/2000/svg'
const WORD = /[\p{L}\p{N}]+/u

/**
 * Cuts a place down to its first word when it is a page rather than words. Changes `range` itself:
 * the engine keeps the very range it drew, and taps are tested against it.
 */
export function shortenPlace(range: Range, max = LONG_PLACE): Range {
  if (range.toString().length <= max) return range
  const doc = range.startContainer.ownerDocument
  if (!doc) return range
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue
    const text = node.nodeValue ?? ''
    const from = node === range.startContainer ? range.startOffset : 0
    const found = WORD.exec(text.slice(from))
    if (!found) continue
    const start = from + found.index
    range.setStart(node, start)
    range.setEnd(node, start + found[0].length)
    return range
  }
  return range
}

/** The engine's drawing of a link's mark: a dotted line under each line of the words. */
export function linkMark(rects: DOMRect[], options: { color?: string } = {}): SVGGElement {
  const color = options.color ?? 'currentColor'
  const g = document.createElementNS(SVG, 'g')
  g.setAttribute('class', 'abele-link-mark')
  for (const r of Array.from(rects)) {
    if (!r.width) continue
    const line = document.createElementNS(SVG, 'line')
    const y = String(r.bottom - 1)
    line.setAttribute('x1', String(r.left + 1))
    line.setAttribute('x2', String(r.right - 1))
    line.setAttribute('y1', y)
    line.setAttribute('y2', y)
    line.setAttribute('stroke', color)
    line.setAttribute('stroke-width', '2')
    line.setAttribute('stroke-linecap', 'round')
    line.setAttribute('stroke-dasharray', '0.1 4')
    g.append(line)
  }
  return g
}

/** Where a point of a page's frame is in the window the reader is in. */
export function pointInWindow(doc: Document, x: number, y: number): { x: number; y: number } {
  const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
  return { x: x + (frame?.left ?? 0), y: y + (frame?.top ?? 0) }
}
