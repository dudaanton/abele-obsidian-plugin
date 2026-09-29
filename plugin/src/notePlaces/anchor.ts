/**
 * A spot in the list under a note, where the note's lines cannot say where the reader is.
 *
 * The list is one block at the end of the note, drawn a moment after it: to the editor, every
 * spot in it is "the last line", so a place saved as a line comes back at the end of the note's
 * text. The rows in the list carry `data-abele-anchor` — what they show, `task:<path>`,
 * `section:tasks` — and the place remembers the row at the top of the view and how far below the
 * top it was. Coming back, once that row is drawn again the view is scrolled to put it there.
 */
import type { AnchorPlace } from './store'

/** The block holding the list under a note, drawn by the editor in live preview. */
const FOOTER = '.abele-footer-widget-container'
const ANCHORED = '[data-abele-anchor]'

/** Where a rect is, as far as the scroller is concerned: its top against the scroller's. */
const topIn = (el: Element, scroller: Element) =>
  el.getBoundingClientRect().top - scroller.getBoundingClientRect().top

/**
 * The row at the top of `scroller`, when the view is scrolled into the list under the note: the
 * innermost row whose box reaches past the top — a task inside its date, not the whole list —
 * and how far below the top it starts. Null while the top of the view is in the note's text.
 */
export function anchorAt(root: HTMLElement, scroller: HTMLElement): AnchorPlace | null {
  const footer = root.querySelector(FOOTER)
  if (!footer || topIn(footer, scroller) > 0) return null
  const top = scroller.getBoundingClientRect().top
  let best: Element | null = null
  // Document order: a list comes before its rows, a row before the next one.
  for (const el of Array.from(footer.querySelectorAll(ANCHORED))) {
    const box = el.getBoundingClientRect()
    if (box.height === 0 || box.bottom <= top) continue
    if (best && !best.contains(el)) break
    best = el
  }
  const key = best?.getAttribute('data-abele-anchor')
  if (!best || !key) return null
  return { key, offset: Math.round(topIn(best, scroller)) }
}

function rowOf(root: HTMLElement, key: string): Element | null {
  const footer = root.querySelector(FOOTER)
  if (!footer) return null
  for (const el of Array.from(footer.querySelectorAll(ANCHORED)))
    if (el.getAttribute('data-abele-anchor') === key && el.getBoundingClientRect().height > 0)
      return el
  return null
}

/** Puts the row `anchor` names back where it was; false while it is not drawn. */
export function alignAnchor(
  root: HTMLElement,
  scroller: HTMLElement,
  anchor: AnchorPlace
): boolean {
  const row = rowOf(root, anchor.key)
  if (!row) return false
  const off = topIn(row, scroller) - anchor.offset
  if (Math.abs(off) > 1) scroller.scrollTop += off
  return true
}

/**
 * Holds the row in place while the list is still being drawn around it: rows above getting
 * their text, a list above getting its dates. Corrected from a ResizeObserver, which runs after
 * layout and before paint, so a row pushed down is put back in the same frame and never seen
 * moving; and once a frame, for a move that changed no size the observer watches.
 */
export function holdAnchor(
  root: HTMLElement,
  scroller: () => HTMLElement | null,
  anchor: AnchorPlace
): () => void {
  let live = true
  const align = () => {
    const s = scroller()
    if (live && s) alignAnchor(root, s, anchor)
  }
  const observer = new ResizeObserver(align)
  const footer = root.querySelector(FOOTER)
  if (footer) observer.observe(footer)
  const content = root.querySelector('.cm-content')
  if (content) observer.observe(content)
  let frame = 0
  const tick = () => {
    align()
    if (live) frame = window.requestAnimationFrame(tick)
  }
  frame = window.requestAnimationFrame(tick)
  return () => {
    live = false
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}
