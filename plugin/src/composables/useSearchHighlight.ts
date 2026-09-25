import { onBeforeUnmount, watch, type Ref } from 'vue'
import { findTextRanges } from '@/helpers/listSearch'

/** How long a burst of changes to the list is let settle before the marks are worked out again. */
const RESCAN_MS = 50

/** The name the stylesheet marks: `::highlight(abele-list-search)`. */
export const SEARCH_HIGHLIGHT = 'abele-list-search'

/**
 * The part of the CSS Custom Highlight API used here. Declared by hand: the TypeScript library
 * this project builds against predates it, though the Chromium inside Obsidian has it.
 */
interface RangeHighlight {
  add(range: Range): unknown
  delete(range: Range): boolean
}

interface HighlightWindow {
  Highlight?: new (...ranges: Range[]) => RangeHighlight
  CSS?: { highlights?: Map<string, RangeHighlight> }
  /** The window itself, which the shared highlight is kept under. */
  key: object
}

/** The element's own window as far as highlights go — read loosely, since the types lack them. */
function windowOf(el: HTMLElement | null | undefined): HighlightWindow | null {
  const win: object | null | undefined = el?.ownerDocument.defaultView
  if (!win) return null
  return { Highlight: Reflect.get(win, 'Highlight'), CSS: Reflect.get(win, 'CSS'), key: win }
}

/** One highlight per window, which every list in that window adds its own ranges to. */
const shared = new WeakMap<object, RangeHighlight>()

function highlightFor(win: HighlightWindow | null): RangeHighlight | null {
  if (!win?.Highlight || !win.CSS?.highlights) return null
  let highlight = shared.get(win.key)
  if (!highlight) {
    highlight = new win.Highlight()
    shared.set(win.key, highlight)
    win.CSS.highlights.set(SEARCH_HIGHLIGHT, highlight)
  }
  return highlight
}

/**
 * Marks the searched-for words in what a list shows.
 *
 * Through the CSS Custom Highlight API rather than by wrapping words in elements: the entries are
 * rendered markdown that Obsidian owns and re-renders, and a highlight only points at text, so it
 * never changes a node of it. Entries render their text a moment after they mount, and more of
 * them mount as the list is scrolled, so the marks are worked out again whenever the markup under
 * `root` changes — at most every few tens of milliseconds. A timer rather than an animation
 * frame: a window hidden behind others paints no frames, and its marks would wait for one.
 * Where the API is missing nothing is marked, and the search works the same.
 */
export function useSearchHighlight(root: Ref<HTMLElement | null>, terms: Ref<string[]>): void {
  let mine: Range[] = []
  let observer: MutationObserver | null = null
  let pending = 0

  const clear = (): void => {
    const el = root.value
    const highlight = highlightFor(windowOf(el))
    for (const range of mine) highlight?.delete(range)
    mine = []
  }

  const apply = (): void => {
    pending = 0
    clear()
    const el = root.value
    if (!el || !terms.value.length) return
    const highlight = highlightFor(windowOf(el))
    if (!highlight) return
    mine = findTextRanges(el, terms.value)
    for (const range of mine) highlight.add(range)
  }

  const schedule = (): void => {
    const win = root.value?.ownerDocument.defaultView
    if (!win || pending) return
    pending = win.setTimeout(apply, RESCAN_MS)
  }

  const stop = (): void => {
    observer?.disconnect()
    observer = null
    const win = root.value?.ownerDocument.defaultView
    if (pending && win) win.clearTimeout(pending)
    pending = 0
  }

  watch(
    [root, terms],
    () => {
      stop()
      const el = root.value
      if (!el || !terms.value.length) {
        clear()
        return
      }
      const win = el.ownerDocument.defaultView
      if (!win) return
      observer = new win.MutationObserver(schedule)
      observer.observe(el, { childList: true, subtree: true, characterData: true })
      apply()
    },
    { flush: 'post' }
  )

  onBeforeUnmount(() => {
    stop()
    clear()
  })
}
