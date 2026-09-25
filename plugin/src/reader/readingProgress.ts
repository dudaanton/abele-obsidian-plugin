/**
 * How far into the chapter and the book the page on screen is, beyond the one percentage the
 * progress line had: the page of the chapter and how many are left in it, as Apple Books and
 * Kindle show them, and a place in the whole book that does not move when the text is made
 * larger.
 *
 * A page is what is on screen at once: a page turned in a book laid out in pages (two side by
 * side counting as one), a screen's height in a chapter scrolled through. Pages change with the
 * text's size and the window's, so the book-wide measure is the engine's location instead: one
 * for every 1500 bytes of the book's text, the measure Foliate itself shows as "Loc".
 */

export type ProgressShow = 'page' | 'left' | 'location' | 'percent'

/** The order a tap on the measure goes through them. */
export const PROGRESS_SHOWS: readonly ProgressShow[] = ['page', 'left', 'location', 'percent']

export interface BookProgress {
  /** The page on screen in its chapter, from 1, and how many the chapter has. */
  page: number
  pages: number
  /** The engine's location in the whole book, from 1, and how many there are. */
  location: number | null
  locations: number | null
}

interface Renderer {
  scrolled?: boolean
  page?: number
  pages?: number
  start?: number
  size?: number
  viewSize?: number
}

interface Relocated {
  location?: { current: number; total: number }
}

/** The measure of a place just reached; null where the renderer says nothing of its pages. */
export function progressOf(detail: Relocated, renderer: Renderer | null): BookProgress | null {
  if (!renderer) return null
  let page: number
  let pages: number
  if (renderer.scrolled) {
    const size = renderer.size ?? 0
    const whole = renderer.viewSize ?? 0
    if (!size || !whole) return null
    pages = Math.max(1, Math.ceil(whole / size - 0.05))
    page = Math.min(pages, Math.floor((renderer.start ?? 0) / size + 0.05) + 1)
  } else {
    // The first and last of the engine's pages are its way into the chapters either side.
    if (typeof renderer.page !== 'number' || typeof renderer.pages !== 'number') return null
    pages = Math.max(1, renderer.pages - 2)
    page = Math.min(pages, Math.max(1, renderer.page))
  }
  const loc = detail.location
  return {
    page,
    pages,
    location: loc ? Math.min(loc.total, loc.current + 1) : null,
    locations: loc ? loc.total : null,
  }
}

/** What the measure says, in each of its ways; null where it has nothing to say that way. */
export function progressText(
  show: ProgressShow,
  progress: BookProgress | null,
  percent: string
): string | null {
  if (show === 'percent') return percent
  if (!progress) return null
  if (show === 'page') return `Page ${progress.page} of ${progress.pages}`
  if (show === 'left') {
    const left = progress.pages - progress.page
    return left === 0
      ? 'Last page in chapter'
      : `${left} ${left === 1 ? 'page' : 'pages'} left in chapter`
  }
  if (progress.location === null || progress.locations === null) return null
  return `Loc ${progress.location} of ${progress.locations}`
}

/** The next way of showing the measure after `show`, skipping any with nothing to say. */
export function nextShow(show: ProgressShow, progress: BookProgress | null): ProgressShow {
  const at = PROGRESS_SHOWS.indexOf(show)
  for (let i = 1; i <= PROGRESS_SHOWS.length; i++) {
    const next = PROGRESS_SHOWS[(at + i) % PROGRESS_SHOWS.length]
    if (progressText(next, progress, '') !== null) return next
  }
  return 'percent'
}
