/**
 * What a page of a book answers to: keys, a tap at its edges, a swipe, a tap on a highlight, and
 * a link out of the book.
 */
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import { isOpenableExternal } from './bookSafety'
import { swipeDirection } from './swipe'
import type { BookModel } from './model'
import type { BookReading } from './BookReading'

export interface PageHost {
  reader(): FoliateView | null
  stage(): HTMLElement | null
  reading(): BookReading | null
  model: BookModel
  pdf: boolean
}

/** Wires one page, as it arrives in its frame, for keys, taps and swipes. */
export function watchPage(host: PageHost, doc: Document): void {
  doc.addEventListener('keydown', (e) => onKey(host.reader(), e))
  doc.addEventListener('click', (e) => onTap(host, e, doc))
  // The engine turns a reflowing book's pages under a finger itself; a PDF's it does not.
  if (host.reader()?.isFixedLayout) watchSwipes(host, doc)
}

function watchSwipes(host: PageHost, doc: Document): void {
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
    if (way === 'left') void reader.goRight()
    else if (way === 'right') void reader.goLeft()
  })
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

/** A tap near the left or right edge turns the page; one on a highlight opens what it offers. */
function onTap(host: PageHost, e: MouseEvent, doc: Document): void {
  const reader = host.reader()
  if (!reader || e.defaultPrevented) return
  if ((e.target as Element | null)?.closest?.('a, area')) return
  if (!doc.getSelection()?.isCollapsed) return
  const marks = host.reading()?.marks
  if (marks) {
    if (host.pdf) {
      const h = marks.hitPdf(doc, e.clientX, e.clientY)
      if (h) {
        host.model.selection = null
        host.model.active = h
        return
      }
    } else if (marks.hitEpub(e)) return
  }
  // A tap beside an open highlight's bar closes it, rather than turning the page as well.
  if (host.model.active) {
    host.model.active = null
    return
  }
  const stage = host.stage()
  const width = stage?.clientWidth ?? 0
  if (!stage || !width) return
  const frame = doc.defaultView?.frameElement
  const x =
    e.clientX + (frame?.getBoundingClientRect().left ?? 0) - stage.getBoundingClientRect().left
  if (x < width * 0.25) void reader.goLeft()
  else if (x > width * 0.75) void reader.goRight()
}
