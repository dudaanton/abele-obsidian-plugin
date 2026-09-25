/**
 * Which way a selection is held against the edge of the page, if it is: by the pointer where one
 * reports itself — the bottom or right edge forward, the top or left back — and otherwise, as
 * under iOS's handles, which tell the page nothing of the finger, by the selection itself.
 */
import { before, type Point } from './pageWords'

export interface HeldAt {
  doc: Document
  range: Range
  /** The page's own box, in the window. */
  box: DOMRect | null
  /** Pages, or a chapter scrolled for now while a selection is carried on — not for good. */
  paged: boolean
  /** Where a pointer that is down is, in the page's box; null for none. */
  pointer: { x: number; y: number } | null
  /** Which end went past the page's text and was stopped at its edge. */
  stopped: 'start' | 'end' | null
  /** Which end the person moved since the selection was made; none for a long press. */
  moved: 'start' | 'end' | null
  /** The page on screen, first word to last. */
  page: () => { start: Point; end: Point } | null
}

export function heldAt(h: HeldAt): 1 | -1 | null {
  const { box, doc, range } = h
  if (h.pointer && box?.width) {
    const { x, y } = h.pointer
    const band = Math.max(32, box.height * 0.07)
    // Scrolled, only its foot and head lead on: its sides are not the way the text goes.
    const side = h.paged ? Math.max(24, box.width * 0.06) : -1
    if (x >= box.width - side || y >= box.height - band) return 1
    if (x <= side || y <= band) return -1
    return null
  }
  if (h.stopped === 'end') return 1
  if (h.stopped === 'start') return -1
  // The moved end's own line in the foot of the page (its head, for the start): WebKit takes a
  // finger below the text for a line near it, and in a scrolled chapter for one out of sight.
  const lines = Array.from(range.getClientRects()).filter((r) => r.width)
  if (box?.height && lines.length) {
    const band = Math.max(48, box.height * 0.12)
    const dy = (doc.defaultView?.frameElement?.getBoundingClientRect().top ?? 0) - box.top
    if (h.moved === 'end' && lines[lines.length - 1].bottom + dy >= box.height - band) return 1
    if (h.moved === 'start' && lines[0].top + dy <= band) return -1
  }
  // A handle brought down onto the page's last word, or up onto its first.
  const page = h.page()
  if (!page) return null
  if (h.moved === 'end' && !before([range.endContainer, range.endOffset], page.end, doc)) return 1
  if (h.moved === 'start' && !before(page.start, [range.startContainer, range.startOffset], doc))
    return -1
  return null
}
