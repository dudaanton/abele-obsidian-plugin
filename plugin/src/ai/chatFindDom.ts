import { foldText, occurrences } from './chatFind'

/**
 * Matches on the page: the text of a drawn part searched the way `chatFind` searches a message,
 * and the matches painted without touching the page.
 *
 * Painted with the browser's highlight registry (`CSS.highlights`) rather than by wrapping the
 * words in marks. The messages are Vue's and their markdown is Obsidian's, both re-drawn at will
 * — a streaming reply many times a second — and a mark written into either would be taken away
 * by the next drawing, or would move the text the reader is holding still. A range is only a
 * pair of places in the text: nothing on the page changes size because of it.
 */

/** The names the stylesheet paints: every match, and the one being shown. */
export const FIND_HIGHLIGHT = 'abele-chat-find'
export const FIND_CURRENT_HIGHLIGHT = 'abele-chat-find-current'

/** Every occurrence of a folded query in an element's text, across the elements inside it. */
export function textRanges(root: Element, foldedQuery: string): Range[] {
  if (!foldedQuery) return []
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const t = node as Text
    nodes.push(t)
    starts.push(text.length)
    text += t.data
  }
  if (!nodes.length) return []

  // The node an offset falls in: the last one starting at or before it.
  const locate = (offset: number, end: boolean): [Text, number] => {
    let lo = 0
    let hi = nodes.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      // An end is placed at the end of the node before rather than at the start of the next.
      if (end ? starts[mid] < offset : starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return [nodes[lo], offset - starts[lo]]
  }

  return occurrences(foldText(text), foldedQuery).map((at) => {
    const range = doc.createRange()
    const [startNode, startOffset] = locate(at, false)
    const [endNode, endOffset] = locate(at + foldedQuery.length, true)
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
  })
}

/** Opens every folded `<details>` between an element and the message it is in. */
export function openFolds(el: Element, stopAt: Element): void {
  for (let at: Element | null = el; at && at !== stopAt; at = at.parentElement) {
    if (at.tagName === 'DETAILS' && !(at as HTMLDetailsElement).open) {
      ;(at as HTMLDetailsElement).open = true
    }
  }
}

interface HighlightWindow {
  CSS?: { highlights?: Map<string, unknown> }
  Highlight?: new (...ranges: Range[]) => unknown
}

/** Whether this window can paint matches at all: Safari before 17.2 cannot. */
export function canHighlight(win: Window | null | undefined): boolean {
  const w = win as unknown as HighlightWindow | null
  return !!w?.CSS?.highlights && typeof w.Highlight === 'function'
}

/** Paints the matches in the chat's own window, which may be a popped-out one. */
export function paintMatches(doc: Document, all: Range[], current: Range | null): void {
  const win = doc.defaultView as unknown as HighlightWindow | null
  if (!win || !canHighlight(doc.defaultView)) return
  const Highlight = win.Highlight!
  const registry = win.CSS!.highlights!
  const rest = current ? all.filter((r) => !sameRange(r, current)) : all
  registry.set(FIND_HIGHLIGHT, new Highlight(...rest))
  if (current) registry.set(FIND_CURRENT_HIGHLIGHT, new Highlight(current))
  else registry.delete(FIND_CURRENT_HIGHLIGHT)
}

export function clearMatches(doc: Document | null | undefined): void {
  const win = doc?.defaultView as unknown as HighlightWindow | null
  if (!win || !canHighlight(doc?.defaultView)) return
  win.CSS!.highlights!.delete(FIND_HIGHLIGHT)
  win.CSS!.highlights!.delete(FIND_CURRENT_HIGHLIGHT)
}

const sameRange = (a: Range, b: Range) =>
  a.startContainer === b.startContainer &&
  a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer &&
  a.endOffset === b.endOffset
