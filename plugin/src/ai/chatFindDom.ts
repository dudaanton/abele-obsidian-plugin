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

interface RangeHighlight {
  add(range: Range): unknown
  delete(range: Range): boolean
}

interface HighlightWindow {
  CSS?: { highlights?: Map<string, RangeHighlight> }
  Highlight?: new (...ranges: Range[]) => RangeHighlight
}

/** Whether this window can paint matches at all: Safari before 17.2 cannot. */
export function canHighlight(win: Window | null | undefined): boolean {
  const w = win as unknown as HighlightWindow | null
  return !!w?.CSS?.highlights && typeof w.Highlight === 'function'
}

/**
 * The window's two highlights, shared by every chat finding in it.
 *
 * Shared rather than one each, because the stylesheet paints a highlight by its name and the
 * names are fixed: two chat panels that each set their own under the same name took each other's
 * marks away. Each chat adds its own ranges to the shared ones and takes back only those.
 */
function sharedHighlights(doc: Document): { all: RangeHighlight; current: RangeHighlight } | null {
  const win = doc.defaultView as unknown as HighlightWindow | null
  if (!win || !canHighlight(doc.defaultView)) return null
  const registry = win.CSS!.highlights!
  const get = (name: string) => {
    let highlight = registry.get(name)
    if (!highlight) {
      highlight = new win.Highlight!()
      registry.set(name, highlight)
    }
    return highlight
  }
  return { all: get(FIND_HIGHLIGHT), current: get(FIND_CURRENT_HIGHLIGHT) }
}

/** One chat's marks: painted over the chat's own window, and taken back without touching another's. */
export function createFindPainter(doc: Document) {
  let mine: { all: Range[]; current: Range | null } = { all: [], current: null }

  const clear = () => {
    const shared = sharedHighlights(doc)
    if (shared) {
      for (const range of mine.all) shared.all.delete(range)
      if (mine.current) shared.current.delete(mine.current)
    }
    mine = { all: [], current: null }
  }

  const paint = (all: Range[], current: Range | null) => {
    clear()
    const shared = sharedHighlights(doc)
    if (!shared) return
    const rest = current ? all.filter((r) => !sameRange(r, current)) : all
    for (const range of rest) shared.all.add(range)
    if (current) shared.current.add(current)
    mine = { all: rest, current }
  }

  return { paint, clear }
}

export type FindPainter = ReturnType<typeof createFindPainter>

const sameRange = (a: Range, b: Range) =>
  a.startContainer === b.startContainer &&
  a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer &&
  a.endOffset === b.endOffset
