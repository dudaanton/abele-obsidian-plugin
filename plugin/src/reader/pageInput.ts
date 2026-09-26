/**
 * What a page of a book answers to: keys, a tap at its edges, a swipe, a tap on a highlight, and
 * a link out of the book.
 */
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import { isOpenableExternal } from './bookSafety'
import { swipeDirection } from './swipe'
import { PDF_SCROLL_TAG } from './pdfScroll'
import { PageGesture } from './pageGesture'
import { TAP_EDGE, pagerFor, pagerOf } from './selectionPaging'
import { figureAt, fitFigures } from './figures'
import type { BookModel } from './model'
import type { BookReading } from './BookReading'

export interface PageHost {
  reader(): FoliateView | null
  stage(): HTMLElement | null
  reading(): BookReading | null
  model: BookModel
  pdf: boolean
  /** Pages of a fixed size — a PDF, a comic — which zoom and are marked by the reader itself. */
  fixed(): boolean
  zoom(way: 'in' | 'out' | 'reset'): void
}

/** Whether a selection's or a highlight's bar is open: the page is held while it is. */
const barOpen = (host: PageHost) => () => !!(host.model.selection || host.model.active)

/** Wires one page, as it arrives in its frame, for keys, taps and swipes. */
export function watchPage(host: PageHost, doc: Document): void {
  doc.addEventListener('keydown', (e) => onKey(host.reader(), e))
  if (host.fixed()) doc.addEventListener('wheel', pinchZoom(host), { passive: false })
  // Pictures and tables as large as the page allows, once they have their size, and again when
  // the page is laid out anew — a phone turned on its side.
  if (!host.fixed()) {
    fitFigures(doc)
    doc.addEventListener('load', () => fitFigures(doc), true)
    doc.defaultView?.addEventListener('resize', () => fitFigures(doc))
  }
  const gesture = new PageGesture(doc, barOpen(host))
  doc.addEventListener('click', (e) => onTap(host, e, doc, gesture))
  const reader = host.reader()
  const renderer = reader?.renderer as
    | (NonNullable<FoliateView['renderer']> & {
        holdPages?: () => boolean
        abeleMargins?: boolean
      })
    | undefined
  // The page's margins are the engine's, outside the page's frame: a tap there is heard there.
  if (renderer && !renderer.abeleMargins) {
    renderer.abeleMargins = true
    renderer.addEventListener('click', (e) => onMarginTap(host, e))
  }
  // The engine's own swipes wait while words are selected or a bar is open.
  if (renderer) renderer.holdPages = barOpen(host)
  pagerFor(doc, {
    // A PDF in one long scroll has no pages to turn under a selection.
    renderer: () => {
      const r = host.reader()?.renderer
      return r && r.localName !== PDF_SCROLL_TAG ? r : null
    },
    stage: () => host.stage(),
    fixed: () => host.fixed(),
    visible: () => host.reader()?.lastLocation?.range ?? null,
    // The bars stay out of the way while words are being selected.
    adjusting: (on) => (host.model.selecting = on),
  })
  // The engine turns a reflowing book's pages under a finger itself; a PDF's it does not — and a
  // PDF in one long scroll is moved by the finger as it is, not turned.
  if (reader?.isFixedLayout && renderer?.localName !== PDF_SCROLL_TAG)
    watchSwipes(host, doc, gesture)
}

function watchSwipes(host: PageHost, doc: Document, gesture: PageGesture): void {
  let start: { x: number; y: number; t: number } | null = null
  doc.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0]
      start = e.touches.length === 1 && t ? { x: t.screenX, y: t.screenY, t: e.timeStamp } : null
    },
    { passive: true }
  )
  doc.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0]
    const reader = host.reader()
    if (!start || !t || !reader) return
    const way = swipeDirection(start, { x: t.screenX, y: t.screenY, t: e.timeStamp })
    start = null
    // A finger that selected, or began over a selection or an open bar, turns nothing.
    if (gesture.selecting) return
    if (way === 'left') void reader.goRight()
    else if (way === 'right') void reader.goLeft()
  })
}

/**
 * Ctrl with the wheel — what a trackpad's pinch sends too — zooms a PDF a step at a time, one
 * step per burst of wheel events rather than one per event.
 */
export function pinchZoom(host: Pick<PageHost, 'zoom' | 'fixed'>): (e: WheelEvent) => void {
  let last = 0
  return (e) => {
    if (!host.fixed() || (!e.ctrlKey && !e.metaKey)) return
    e.preventDefault()
    if (e.timeStamp - last < 120 || !e.deltaY) return
    last = e.timeStamp
    host.zoom(e.deltaY < 0 ? 'in' : 'out')
  }
}

/** A link out of the book: to the browser if it is to the web or mail, nowhere otherwise. */
export function onExternalLink(e: CustomEvent<{ href_?: string }>): void {
  e.preventDefault()
  const href = e.detail?.href_ ?? ''
  if (isOpenableExternal(href)) window.open(href, '_blank')
}

export function onKey(reader: FoliateView | null, e: KeyboardEvent): void {
  if (!reader) return
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault()
    void reader.goLeft()
  } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
    e.preventDefault()
    void reader.goRight()
  }
}

/**
 * A tap near the left or right edge turns the page; one on a highlight opens what it offers. Only
 * a clean tap turns it: one beside an open bar closes the bar, and one that had anything to do
 * with a selection does nothing else.
 */
function onTap(host: PageHost, e: MouseEvent, doc: Document, gesture: PageGesture): void {
  const reader = host.reader()
  if (!reader || e.defaultPrevented) return
  if ((e.target as Element | null)?.closest?.('a, area')) return
  // Words selected, and a tap on the very edge of the page: it turns, the selection going on.
  // Letting go of the mouse after selecting them is not a tap, wherever it is let go.
  const started = gesture.startedWith
  if (started || !doc.getSelection()?.isCollapsed) {
    if (gesture.dragged) return
    const edge = edgeOf(host, e, doc, TAP_EDGE)
    if (edge) void pagerOf(doc)?.tapTurn(edge, started)
    return
  }
  const marks = host.reading()?.marks
  if (marks) {
    if (host.fixed()) {
      const h = marks.hitPdf(doc, e.clientX, e.clientY)
      if (h) {
        marks.open(h)
        return
      }
      if (marks.openLinkAt(doc, e.clientX, e.clientY)) return
    } else if (marks.hitEpub(e)) return
  }
  // A tap beside an open highlight's bar closes it, rather than turning the page as well.
  if (host.model.active) {
    host.model.active = null
    return
  }
  if (!gesture.cleanTap) return
  // A picture or a table opens full screen, wherever on the page it is.
  const figure = host.fixed() ? null : figureAt(e.target as Element | null)
  if (figure) {
    host.model.figure = figure
    return
  }
  const edge = edgeOf(host, e, doc, 0.25)
  if (edge === -1) void reader.goLeft()
  else if (edge === 1) void reader.goRight()
}

/**
 * A tap on the margin beside the page's text, which the page's frame does not cover: a turn,
 * as a tap on the edge of the text would be — carrying words selected on — and nothing else.
 */
function onMarginTap(host: PageHost, e: MouseEvent): void {
  const reader = host.reader()
  const doc = (reader?.renderer?.getContents() ?? [])[0]?.doc
  if (!reader || !doc || e.defaultPrevented) return
  const stage = host.stage()
  const width = stage?.clientWidth ?? 0
  if (!stage || !width) return
  const x = e.clientX - stage.getBoundingClientRect().left
  const edge = (share: number): 1 | -1 | null =>
    x < width * share ? -1 : x > width * (1 - share) ? 1 : null
  if (!doc.getSelection()?.isCollapsed) {
    const dir = edge(TAP_EDGE)
    if (dir) void pagerOf(doc)?.tapTurn(dir, null)
    return
  }
  if (host.model.active || host.model.selection) {
    host.model.active = null
    return
  }
  const dir = edge(0.25)
  if (dir === -1) void reader.goLeft()
  else if (dir === 1) void reader.goRight()
}

/** The edge of the page a tap was on, within `share` of its width either side: -1 left, 1 right. */
function edgeOf(host: PageHost, e: MouseEvent, doc: Document, share: number): 1 | -1 | null {
  const stage = host.stage()
  const width = stage?.clientWidth ?? 0
  if (!stage || !width) return null
  const frame = doc.defaultView?.frameElement
  const x =
    e.clientX + (frame?.getBoundingClientRect().left ?? 0) - stage.getBoundingClientRect().left
  if (x < width * share) return -1
  if (x > width * (1 - share)) return 1
  return null
}
