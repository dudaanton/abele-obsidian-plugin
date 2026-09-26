/**
 * A PDF as one continuous scroll, page under page — the way PDFs are usually read — in place of
 * the engine's one-page-at-a-time renderer.
 *
 * It speaks the engine's renderer interface (`open`, `goTo`, `next`, `prev`, `getContents`,
 * `destroy`, the `load` and `relocate` events, the `zoom` attribute), so the rest of the reader —
 * the progress line, places, links, search, highlights — works as with pages. Only the pages near
 * the screen are drawn: each has a slot of its size in the scroll, and a frame is made when the
 * slot comes near and dropped when it goes far away, so a long PDF costs what a few pages cost.
 * Each page frame is the same sandboxed page as in the page-at-a-time view (`pdfBook.ts`).
 */
import { frameOptions } from '@/vendor/foliate-js/frame-options.js'
import { defineElement, tagName } from '@/vendor/foliate-js/elements.js'
import { keepPoint, type Point } from './pdfZoom'

/** The element's name in this load of the plugin, as the engine's own are (`elements.js`). */
export const PDF_SCROLL_TAG = tagName('abele-pdf-scroll')

interface PageSource {
  src: string
  onZoom?: (z: { doc: Document; scale: number }) => void
}

interface Section {
  load(): unknown
  unload?(): void
}

interface ScrollBook {
  sections: Section[]
  pageSize?(index: number): Promise<{ width: number; height: number }>
}

interface Slot {
  el: HTMLElement
  width: number
  height: number
  known: boolean
  frame: HTMLIFrameElement | null
  doc: Document | null
  loading: boolean
}

/** The space between pages, and around them. */
const GAP = 12
/** How far past the screen, in screens, pages are kept drawn. */
const KEEP = 1.5

/** A page's scale for a zoom setting, in a column `width` wide and a screen `height` tall. */
export function pageScale(
  zoom: string,
  page: { width: number; height: number },
  width: number,
  height: number
): number {
  const fitWidth = Math.max(0.1, (width - GAP * 2) / page.width)
  if (zoom === 'fit-width') return Math.min(fitWidth, 3)
  if (zoom === 'fit-page')
    return Math.min(fitWidth, Math.max(0.1, (height - GAP * 2) / page.height))
  const n = Number(zoom)
  return Number.isFinite(n) && n > 0 ? n : Math.min(fitWidth, 3)
}

/** Which page a scroll position is in, and how far down it: slots stacked from `tops`. */
export function pageAt(
  tops: number[],
  heights: number[],
  y: number
): { index: number; fraction: number } {
  let index = 0
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= y) index = i
    else break
  }
  const h = heights[index] || 1
  return { index, fraction: Math.min(1, Math.max(0, (y - tops[index]) / h)) }
}

export class PdfScroll extends HTMLElement {
  static observedAttributes = ['zoom']
  #root = this.attachShadow({ mode: 'closed' })
  #scroller: HTMLElement
  #column: HTMLElement
  #slots: Slot[] = []
  #book: ScrollBook | null = null
  #zoom = 'fit-width'
  #index = 0
  #fraction = 0
  #frame = 0
  #observer = new ResizeObserver(() => this.#layout(true))
  #sizesDone = false
  /** The slots have been sized for the screen: until then no page is on it. */
  #laidOut = false

  constructor() {
    super()
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`
      :host { display: block; width: 100%; height: 100%; }
      #scroller { position: relative; width: 100%; height: 100%; overflow: auto;
        overscroll-behavior: contain; }
      #column { display: flex; flex-direction: column; align-items: center; gap: ${GAP}px;
        padding: ${GAP}px 0; width: max-content; min-width: 100%; box-sizing: border-box; }
      .slot { position: relative; flex: 0 0 auto; }
      iframe { border: 0; display: block; position: absolute; left: 0; top: 0; }
    `)
    this.#root.adoptedStyleSheets = [sheet]
    this.#scroller = this.ownerDocument.win.createDiv()
    this.#scroller.id = 'scroller'
    this.#column = this.ownerDocument.win.createDiv()
    this.#column.id = 'column'
    this.#scroller.append(this.#column)
    this.#root.append(this.#scroller)
    this.#scroller.addEventListener('scroll', () => this.#onScroll(), { passive: true })
  }

  connectedCallback(): void {
    this.#observer.observe(this)
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'zoom' && value && value !== this.#zoom) {
      this.#zoom = value
      this.#layout(true)
    }
  }

  open(book: ScrollBook): void {
    this.#book = book
    this.#column.replaceChildren()
    this.#slots = book.sections.map((): Slot => {
      const el = this.ownerDocument.win.createDiv()
      el.className = 'slot'
      el.setAttribute('part', 'page')
      this.#column.append(el)
      return { el, width: 612, height: 792, known: false, frame: null, doc: null, loading: false }
    })
    void this.#readSizes()
  }

  /** Every page's own size, first page first: until one is known its slot takes the first's. */
  async #readSizes(): Promise<void> {
    const book = this.#book
    if (!book?.pageSize) return
    for (let i = 0; i < this.#slots.length; i++) {
      if (this.#book !== book) return
      try {
        const size = await book.pageSize(i)
        const slot = this.#slots[i]
        slot.width = size.width
        slot.height = size.height
        slot.known = true
        if (i === 0)
          for (const other of this.#slots)
            if (!other.known) {
              other.width = size.width
              other.height = size.height
            }
      } catch {
        // A page that will not say its size keeps the first page's.
      }
      // Laid out again now and then, not after every page: the scroll holds its place each time.
      if (i === 0 || i % 50 === 49 || i === this.#slots.length - 1) this.#layout(false)
    }
    this.#sizesDone = true
  }

  #scaleOf(slot: Slot): number {
    return pageScale(this.#zoom, slot, this.#scroller.clientWidth, this.#scroller.clientHeight)
  }

  /** Sizes every slot for the zoom, keeping the page on screen where it was. */
  #layout(redraw: boolean): void {
    if (!this.#slots.length || !this.#scroller.clientHeight) return
    const keepIndex = this.#index
    const keepFraction = this.#fraction
    this.#size()
    this.#laidOut = true
    this.#restore(keepIndex, keepFraction)
    if (redraw) this.#redrawAll()
    this.#update()
  }

  /**
   * Sets the zoom and keeps a point of the pages — `from`, in this element's box before — at `to`,
   * sideways too: the place under a pinch's fingers stays under them. Without a point, the page
   * being read stays where it was, as for any other change of size.
   */
  zoomAt(zoom: string, from?: Point, to?: Point): void {
    this.#zoom = zoom
    // Said on the element too, so the attribute reads as the zoom it has; heard as no change.
    if (this.getAttribute('zoom') !== zoom) this.setAttribute('zoom', zoom)
    if (!from || !to || !this.#laidOut || !this.#scroller.clientHeight) {
      this.#layout(true)
      return
    }
    const content = { x: from.x + this.#scroller.scrollLeft, y: from.y + this.#scroller.scrollTop }
    const { tops, heights } = this.#tops()
    const slot = this.#slots[pageAt(tops, heights, content.y).index]
    const box = (el: HTMLElement) => ({
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    })
    const before = box(slot.el)
    this.#size()
    const scroll = keepPoint(before, content, box(slot.el), to)
    this.#scroller.scrollLeft = scroll.x
    this.#scroller.scrollTop = scroll.y
    this.#redrawAll()
    this.#update()
  }

  /** Every slot, and every frame in one, at the size the zoom gives its page. */
  #size(): void {
    for (const slot of this.#slots) {
      const scale = this.#scaleOf(slot)
      slot.el.style.setProperty('width', `${slot.width * scale}px`)
      slot.el.style.setProperty('height', `${slot.height * scale}px`)
      if (slot.frame) {
        slot.frame.style.setProperty('width', `${slot.width * scale}px`)
        slot.frame.style.setProperty('height', `${slot.height * scale}px`)
      }
    }
  }

  /** The pages drawn now, drawn again at their size: those on the screen first. */
  #redrawAll(): void {
    const top = this.#scroller.scrollTop
    const bottom = top + this.#scroller.clientHeight
    const order = this.#slots
      .map((slot, i) => ({
        i,
        on: slot.el.offsetTop < bottom && slot.el.offsetTop + slot.el.offsetHeight > top,
      }))
      .sort((a, b) => Number(b.on) - Number(a.on))
    for (const { i } of order) this.#redraw(i)
  }

  #redraw(i: number): void {
    const slot = this.#slots[i]
    const source = slot.frame && (slot.frame as unknown as { __source?: PageSource }).__source
    if (slot.doc && source?.onZoom) source.onZoom({ doc: slot.doc, scale: this.#scaleOf(slot) })
  }

  #tops(): { tops: number[]; heights: number[] } {
    return {
      tops: this.#slots.map((s) => s.el.offsetTop),
      heights: this.#slots.map((s) => s.el.offsetHeight),
    }
  }

  /** The page's top at the top of the screen. */
  #scrollToPage(index: number): void {
    const slot = this.#slots[index]
    if (!slot) return
    this.#scroller.scrollTop = slot.el.offsetTop - GAP
  }

  /** The reading point — a third of the way down the screen — back where it was in its page. */
  #restore(index: number, fraction: number): void {
    const slot = this.#slots[index]
    if (!slot) return
    this.#scroller.scrollTop =
      slot.el.offsetTop + fraction * slot.el.offsetHeight - this.#scroller.clientHeight / 3
  }

  #onScroll(): void {
    if (this.#frame) return
    this.#frame = window.requestAnimationFrame(() => {
      this.#frame = 0
      this.#update()
    })
  }

  /** Which page is on screen now, the frames kept near it, and where the reader is. */
  #update(): void {
    // Before the slots have their sizes every page stands at the top, and the last would win.
    if (!this.#laidOut) return
    const { tops, heights } = this.#tops()
    // The page a third of the way down the screen is the one being read.
    const y = this.#scroller.scrollTop + this.#scroller.clientHeight / 3
    const at = pageAt(tops, heights, y)
    const top = this.#scroller.scrollTop - this.#scroller.clientHeight * KEEP
    const bottom = this.#scroller.scrollTop + this.#scroller.clientHeight * (1 + KEEP)
    this.#slots.forEach((slot, i) => {
      const near = tops[i] + heights[i] >= top && tops[i] <= bottom
      if (near && !slot.frame && !slot.loading) void this.#load(i)
      else if (!near && slot.frame) this.#unload(i)
    })
    const changed = at.index !== this.#index || Math.abs(at.fraction - this.#fraction) > 0.001
    this.#index = at.index
    this.#fraction = at.fraction
    if (changed) this.#relocate('scroll')
  }

  #relocate(reason: string): void {
    this.dispatchEvent(
      new CustomEvent('relocate', {
        detail: { reason, range: null, index: this.#index, fraction: this.#fraction, size: 1 },
      })
    )
  }

  async #load(i: number): Promise<void> {
    const slot = this.#slots[i]
    const section = this.#book?.sections[i]
    if (!section) return
    slot.loading = true
    try {
      const source = (await section.load()) as PageSource
      if (slot.frame || !slot.loading) return
      const frame = this.ownerDocument.win.createEl('iframe')
      frame.setAttribute('sandbox', frameOptions.sandbox)
      frame.setAttribute('scrolling', 'no')
      frame.setAttribute('part', 'filter')
      ;(frame as unknown as { __source?: PageSource }).__source = source
      const scale = this.#scaleOf(slot)
      frame.style.setProperty('width', `${slot.width * scale}px`)
      frame.style.setProperty('height', `${slot.height * scale}px`)
      const onLoad = () => {
        const doc = frame.contentDocument
        // The blank page a frame holds before its own arrives is not the page.
        if (!doc || doc.URL === 'about:blank') return
        frame.removeEventListener('load', onLoad)
        {
          slot.doc = doc
          this.dispatchEvent(new CustomEvent('load', { detail: { doc, index: i } }))
          source.onZoom?.({ doc, scale: this.#scaleOf(slot) })
        }
      }
      frame.addEventListener('load', onLoad)
      slot.frame = frame
      frame.src = source.src
      slot.el.append(frame)
    } finally {
      slot.loading = false
    }
  }

  #unload(i: number): void {
    const slot = this.#slots[i]
    slot.frame?.remove()
    slot.frame = null
    slot.doc = null
    slot.loading = false
  }

  async goTo(
    target:
      | { index: number; anchor?: unknown }
      | null
      | undefined
      | Promise<{ index: number } | null>
  ): Promise<void> {
    const resolved = await target
    if (!resolved || resolved.index < 0 || resolved.index >= this.#slots.length) return
    this.#index = resolved.index
    this.#fraction = 0
    // Laid out later, the reading point is put back on this page's top third.
    if (!this.#laidOut) {
      this.#relocate('navigation')
      return
    }
    this.#scrollToPage(resolved.index)
    this.#update()
    this.#relocate('navigation')
  }

  async next(): Promise<void> {
    this.#scroller.scrollBy({ top: this.#scroller.clientHeight * 0.9 })
    this.#update()
  }

  async prev(): Promise<void> {
    this.#scroller.scrollBy({ top: -this.#scroller.clientHeight * 0.9 })
    this.#update()
  }

  /** Moves the pages by a distance, as a finger dragging them would: drawing mode's own finger. */
  panBy(dx: number, dy: number): void {
    this.#scroller.scrollBy({ left: dx, top: dy, behavior: 'instant' })
  }

  /** The pages drawn now, the one being read first. */
  getContents(): { doc: Document; index: number }[] {
    const drawn = this.#slots.map((slot, index) => ({ doc: slot.doc, index })).filter((c) => c.doc)
    return drawn.sort(
      (a, b) =>
        Math.abs(a.index - this.#index) - Math.abs(b.index - this.#index) || a.index - b.index
    )
  }

  /** The scale the page being read is drawn at. */
  get scale(): number {
    const slot = this.#slots[this.#index]
    return slot ? this.#scaleOf(slot) : 1
  }

  /** The page being read. */
  get index(): number {
    return this.#index
  }

  /** Whether every page's size has been read, for the tests. */
  get sized(): boolean {
    return this.#sizesDone
  }

  destroy(): void {
    this.#observer.disconnect()
    this.#book = null
    for (let i = 0; i < this.#slots.length; i++) this.#unload(i)
  }
}

/**
 * Defines the element in a window. The class is this window's; a pop-out window, whose tags the
 * engine does not define either, is not offered books.
 */
export function definePdfScroll(win: Window): void {
  defineElement('abele-pdf-scroll', PdfScroll, win.customElements)
}
