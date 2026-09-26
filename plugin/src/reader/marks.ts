/**
 * Highlights drawn over the page.
 *
 * In a book the engine draws them: each is an annotation on its chapter's overlay, added again
 * whenever that chapter's page is made, and a tap on one is reported back. A PDF's pages have no
 * overlay in the engine, so there the highlights are boxes laid over the page's text layer, drawn
 * again every time the page is (a new size redraws the text), and a tap is tested against them.
 *
 * A discussion — words asked about with "Ask here" — is marked apart from a highlight: a small
 * speech bubble at the end of the words, over their highlight if they have one, or over an
 * underline in the theme's accent if they were only asked about.
 */
import { Overlayer } from '@/vendor/foliate-js/overlayer.js'
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import type { Highlight, HighlightColor } from './highlights'
import { LINK_KEY, linkMark, pointInWindow, shortenPlace } from './linkMarks'

export const MARKS_CLASS = 'abele-marks'

interface Box {
  range: Range
  color: string
  cfi?: string
  /** A discussion's mark: `under` for words only asked about, `over` for a highlight. */
  discussion?: 'under' | 'over'
  /** Words a note links to: a dotted underline, tested apart from highlights. */
  link?: string
}

const SVG = 'http://www.w3.org/2000/svg'
/** A speech bubble, 10 wide and 9 high, drawn from its top left corner. */
const BUBBLE =
  'M1.5 0h7A1.5 1.5 0 0 1 10 1.5v4A1.5 1.5 0 0 1 8.5 7H4L1.5 9V7A1.5 1.5 0 0 1 0 5.5v-4A1.5 1.5 0 0 1 1.5 0z'

/**
 * The engine's drawing of a discussion: its words underlined or highlighted, and the bubble over
 * the end of the last line, where a tap on it still lands on the words and opens the chat.
 */
export function discussionMark(plain: boolean) {
  return (rects: DOMRect[], options: { color?: string } = {}): SVGGElement => {
    const color = options.color ?? 'currentColor'
    const words = plain
      ? (Overlayer.underline(rects, { color, width: 2 }) as SVGGElement)
      : (Overlayer.highlight(rects, { color }) as SVGGElement)
    const g = document.createElementNS(SVG, 'g')
    g.append(words)
    const last = rects[rects.length - 1]
    if (last) {
      const bubble = document.createElementNS(SVG, 'path')
      bubble.setAttribute('d', BUBBLE)
      bubble.setAttribute('fill', color)
      // Half as large again as drawn: a speech bubble a phone's reader can make out.
      bubble.setAttribute('transform', `translate(${last.right - 13} ${last.top - 10}) scale(1.4)`)
      bubble.setAttribute('class', 'abele-discussion-bubble')
      g.append(bubble)
    }
    return g
  }
}

const XHTML = 'http://www.w3.org/1999/xhtml'

/**
 * Boxes over ranges of a page, in a layer of their own after its body — so the body's place,
 * which every CFI in the page goes through, is kept. Styled on the elements themselves: a page
 * of a book carries none of the reader's styles. A page drawn scaled down by the screen's pixel
 * ratio (a PDF's) has its boxes scaled with it.
 */
export function drawBoxes(doc: Document, layerClass: string, items: Box[], opacity = 0.35): void {
  const root = doc.documentElement
  root.querySelector(`:scope > .${layerClass}`)?.remove()
  if (!items.length) return
  const layer = doc.createElementNS(XHTML, 'div')
  layer.className = layerClass
  layer.setAttribute('aria-hidden', 'true')
  for (const [k, v] of Object.entries({
    position: 'absolute',
    left: '0',
    top: '0',
    width: '0',
    height: '0',
    'pointer-events': 'none',
  }))
    layer.style.setProperty(k, v)
  root.appendChild(layer)
  const base = root.getBoundingClientRect()
  const scale = base.width ? root.offsetWidth / base.width : 1
  for (const item of items) {
    const rects = Array.from(item.range.getClientRects())
    const under = item.discussion === 'under'
    for (const rect of rects) {
      const box = doc.createElementNS(XHTML, 'div')
      box.className = `${layerClass}__box`
      if (item.cfi) box.dataset.cfi = item.cfi
      if (item.link) box.dataset.link = item.link
      for (const [k, v] of Object.entries({
        position: 'absolute',
        left: `${(rect.left - base.left) * scale}px`,
        top: `${(rect.top - base.top) * scale}px`,
        width: `${rect.width * scale}px`,
        height: `${rect.height * scale}px`,
        // Words only asked about are underlined, not filled: they are not a highlight. Words a
        // note links to are dotted.
        ...(item.link
          ? { 'border-bottom': `2px dotted ${item.color}`, 'box-sizing': 'border-box' }
          : under
            ? { 'border-bottom': `2px solid ${item.color}`, 'box-sizing': 'border-box' }
            : {
                'background-color': item.color,
                opacity: String(opacity),
                'mix-blend-mode': 'multiply',
              }),
        'border-radius': '2px',
      }))
        box.style.setProperty(k, v)
      layer.appendChild(box)
    }
    const last = rects[rects.length - 1]
    if (item.discussion && last) {
      const bubble = doc.createElementNS(SVG, 'svg')
      bubble.setAttribute('class', `${layerClass}__bubble`)
      bubble.setAttribute('viewBox', '0 0 10 9')
      const path = doc.createElementNS(SVG, 'path')
      path.setAttribute('d', BUBBLE)
      path.setAttribute('fill', item.color)
      bubble.append(path)
      for (const [k, v] of Object.entries({
        position: 'absolute',
        left: `${(last.right - base.left - 13) * scale}px`,
        top: `${(last.top - base.top - 10) * scale}px`,
        width: `${14 * scale}px`,
        height: `${12.6 * scale}px`,
      }))
        bubble.style.setProperty(k, v)
      layer.appendChild(bubble)
    }
  }
}

interface Resolved {
  index: number
  anchor?: (doc: Document) => Range | Element | null
}

/** The colour of a highlight, as a literal a page frame and an SVG can use. */
export function markColor(el: HTMLElement, color: HighlightColor): string {
  const value = getComputedStyle(el).getPropertyValue(`--color-${color}`).trim()
  return value || color
}

export class BookMarks {
  private list: Highlight[] = []
  private drawn = new Set<string>()
  /** The page documents of a PDF on screen, by their index. */
  private pdfDocs = new Map<number, Document>()
  /** The places notes link to (`linkedNotes.ts`), and the ones drawn in a book's chapters. */
  private links: string[] = []
  private linksDrawn = new Set<string>()
  /** Words a note links to tapped, with where on the screen, for a menu of the notes. */
  onLink: (cfi: string, at: { x: number; y: number }) => void = () => {}

  constructor(
    private readonly engine: FoliateView,
    private readonly themeEl: HTMLElement,
    private readonly pdf: boolean,
    private readonly onTap: (h: Highlight) => void
  ) {
    if (pdf) return
    engine.addEventListener('draw-annotation', (e) => {
      const { draw, annotation } = (e as CustomEvent).detail as {
        draw: (fn: unknown, opts: unknown) => void
        annotation: { value: string }
      }
      if (annotation.value.startsWith(LINK_KEY)) {
        const { range } = (e as CustomEvent).detail as { range?: Range }
        if (range && 'setStart' in range) shortenPlace(range)
        draw(linkMark, { color: this.accent() })
        return
      }
      const h = this.list.find((x) => x.cfi === annotation.value)
      if (!h) return
      if (h.discussion)
        draw(discussionMark(!!h.plain), {
          color: h.plain ? this.accent() : markColor(this.themeEl, h.color),
        })
      else draw(Overlayer.highlight, { color: markColor(this.themeEl, h.color) })
    })
    // A chapter's page is made anew on every visit: its highlights go back on.
    engine.addEventListener('create-overlay', (e) => {
      const index = (e as CustomEvent<{ index: number }>).detail.index
      for (const cfi of this.links) if (this.indexOf(cfi) === index) void this.addLink(cfi)
      for (const h of this.list) if (this.indexOf(h.cfi) === index) void this.addEpub(h)
    })
    engine.addEventListener('show-annotation', (e) => {
      const { value, range } = (e as CustomEvent<{ value: string; range?: Range }>).detail
      if (value.startsWith(LINK_KEY)) {
        const rect = range?.getBoundingClientRect?.()
        const doc = range?.startContainer.ownerDocument
        const at = doc && rect ? pointInWindow(doc, rect.left, rect.bottom) : { x: 0, y: 0 }
        this.onLink(value.slice(LINK_KEY.length), at)
        return
      }
      const h = this.list.find((x) => x.cfi === value)
      if (h) this.onTap(h)
    })
  }

  private resolve(cfi: string): Resolved | null {
    try {
      return (
        (
          this.engine as unknown as { resolveNavigation(t: string): Resolved | null }
        ).resolveNavigation(cfi) ?? null
      )
    } catch {
      return null
    }
  }

  /** The theme's accent as a literal: the colour of words only asked about. */
  private accent(): string {
    return (
      getComputedStyle(this.themeEl).getPropertyValue('--interactive-accent').trim() || 'purple'
    )
  }

  private indexOf(cfi: string): number {
    return this.resolve(cfi)?.index ?? -1
  }

  private async addEpub(h: Highlight): Promise<void> {
    try {
      await (
        this.engine as unknown as { addAnnotation(a: { value: string }): Promise<unknown> }
      ).addAnnotation({ value: h.cfi })
      this.drawn.add(h.cfi)
    } catch (e) {
      console.debug('[Abele] a highlight could not be drawn', h.cfi, e)
    }
  }

  private removeEpub(cfi: string): void {
    this.drawn.delete(cfi)
    void (this.engine as unknown as { deleteAnnotation(a: { value: string }): Promise<unknown> })
      .deleteAnnotation({ value: cfi })
      ?.catch?.(() => {})
  }

  private async addLink(cfi: string): Promise<void> {
    try {
      await (
        this.engine as unknown as {
          addAnnotation(a: { value: string; cfi: string }): Promise<unknown>
        }
      ).addAnnotation({ value: LINK_KEY + cfi, cfi })
      this.linksDrawn.add(cfi)
    } catch (e) {
      console.debug('[Abele] a linked place could not be marked', cfi, e)
    }
  }

  /**
   * The places notes link to, as they are now. In a book only the chapters showing are marked:
   * the rest are when their page is made (`create-overlay`).
   */
  setLinks(places: string[]): void {
    const before = new Set(this.links)
    this.links = [...places]
    if (this.pdf) {
      for (const [index, doc] of this.pdfDocs) this.drawPdf(doc, index)
      return
    }
    const now = new Set(places)
    for (const cfi of before)
      if (!now.has(cfi)) {
        this.linksDrawn.delete(cfi)
        void (
          this.engine as unknown as {
            deleteAnnotation(a: { value: string; cfi: string }): Promise<unknown>
          }
        )
          .deleteAnnotation({ value: LINK_KEY + cfi, cfi })
          ?.catch?.(() => {})
      }
    const showing = new Set(
      (this.engine.renderer as unknown as { getContents(): { index: number }[] })
        .getContents()
        .map((c) => c.index)
    )
    for (const cfi of places)
      if (!before.has(cfi) && showing.has(this.indexOf(cfi))) void this.addLink(cfi)
  }

  /** The highlights to show, as the book's note has them now. */
  set(list: Highlight[]): void {
    const before = new Map(this.list.map((h) => [h.cfi, h]))
    this.list = list.map((h) => ({ ...h }))
    if (this.pdf) {
      for (const [index, doc] of this.pdfDocs) this.drawPdf(doc, index)
      return
    }
    const now = new Set(this.list.map((h) => h.cfi))
    for (const cfi of before.keys()) if (!now.has(cfi)) this.removeEpub(cfi)
    for (const h of this.list) {
      const old = before.get(h.cfi)
      const changed =
        !old || old.color !== h.color || old.discussion !== h.discussion || old.plain !== h.plain
      if (changed || !this.drawn.has(h.cfi)) void this.addEpub(h)
    }
  }

  /** A highlight tapped on a page the reader marks itself: what the engine's tap does. */
  open(h: Highlight): void {
    this.onTap(h)
  }

  /** Colours changed with the theme: draw everything again. */
  redraw(): void {
    const list = this.list
    this.list = []
    for (const cfi of [...this.drawn]) this.removeEpub(cfi)
    this.set(list)
    const links = this.links
    this.setLinks([])
    this.setLinks(links)
  }

  /** A page of fixed size was drawn: its highlights go over it, over its fresh text layer. */
  drawPdf(doc: Document, index: number): void {
    this.pdfDocs.set(index, doc)
    for (const [i, d] of this.pdfDocs) if (!d.defaultView) this.pdfDocs.delete(i)
    const mine = this.list.filter((h) => this.indexOf(h.cfi) === index)
    const items: Box[] = []
    for (const h of mine) {
      const range = this.rangeIn(doc, h.cfi)
      if (!range) continue
      items.push({
        range,
        color: h.discussion && h.plain ? this.accent() : markColor(this.themeEl, h.color),
        cfi: h.cfi,
        ...(h.discussion ? { discussion: h.plain ? ('under' as const) : ('over' as const) } : {}),
      })
    }
    for (const cfi of this.links) {
      if (this.indexOf(cfi) !== index) continue
      const range = this.rangeIn(doc, cfi)
      if (range) items.push({ range: shortenPlace(range), color: this.accent(), link: cfi })
    }
    drawBoxes(doc, MARKS_CLASS, items)
  }

  private rangeIn(doc: Document, cfi: string): Range | null {
    const anchor = this.resolve(cfi)?.anchor?.(doc)
    if (!anchor) return null
    if (anchor instanceof doc.defaultView.Range) return anchor
    const range = doc.createRange()
    range.selectNodeContents(anchor)
    return range
  }

  /** The highlight under a point of a PDF page, in the page's own coordinates. */
  hitPdf(doc: Document, x: number, y: number): Highlight | null {
    for (const box of Array.from(
      doc.querySelectorAll<HTMLElement>(`.${MARKS_CLASS}__box[data-cfi]`)
    )) {
      const r = box.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return this.list.find((h) => h.cfi === box.dataset.cfi) ?? null
    }
    return null
  }

  /** Words a note links to under a point of a fixed page, opened as a tap on them in a book is. */
  openLinkAt(doc: Document, x: number, y: number): boolean {
    for (const box of Array.from(
      doc.querySelectorAll<HTMLElement>(`.${MARKS_CLASS}__box[data-link]`)
    )) {
      const r = box.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top - 4 && y <= r.bottom + 4) {
        this.onLink(box.dataset.link ?? '', pointInWindow(doc, r.left, r.bottom))
        return true
      }
    }
    return false
  }

  /** Whether a tap on a book's page landed on a highlight, which then answers it instead. */
  hitEpub(e: MouseEvent): boolean {
    const contents = (
      this.engine.renderer as unknown as {
        getContents(): { overlayer?: { hitTest(p: { x: number; y: number }): [string?] } }[]
      }
    ).getContents()
    return contents.some((c) => !!c.overlayer?.hitTest({ x: e.clientX, y: e.clientY })?.[0])
  }
}
