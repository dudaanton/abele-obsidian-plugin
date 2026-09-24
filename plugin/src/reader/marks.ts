/**
 * Highlights drawn over the page.
 *
 * In a book the engine draws them: each is an annotation on its chapter's overlay, added again
 * whenever that chapter's page is made, and a tap on one is reported back. A PDF's pages have no
 * overlay in the engine, so there the highlights are boxes laid over the page's text layer, drawn
 * again every time the page is (a new size redraws the text), and a tap is tested against them.
 */
import { Overlayer } from '@/vendor/foliate-js/overlayer.js'
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import type { Highlight, HighlightColor } from './highlights'

export const MARKS_CLASS = 'abele-marks'

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
      const h = this.list.find((x) => x.cfi === annotation.value)
      if (h) draw(Overlayer.highlight, { color: markColor(this.themeEl, h.color) })
    })
    // A chapter's page is made anew on every visit: its highlights go back on.
    engine.addEventListener('create-overlay', (e) => {
      const index = (e as CustomEvent<{ index: number }>).detail.index
      for (const h of this.list) if (this.indexOf(h.cfi) === index) void this.addEpub(h)
    })
    engine.addEventListener('show-annotation', (e) => {
      const value = (e as CustomEvent<{ value: string }>).detail.value
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
      if (!old || old.color !== h.color || !this.drawn.has(h.cfi)) void this.addEpub(h)
    }
  }

  /** Colours changed with the theme: draw everything again. */
  redraw(): void {
    const list = this.list
    this.list = []
    for (const cfi of [...this.drawn]) this.removeEpub(cfi)
    this.set(list)
  }

  /** A PDF page was drawn: its highlights go over its fresh text layer. */
  drawPdf(doc: Document, index: number): void {
    this.pdfDocs.set(index, doc)
    for (const [i, d] of this.pdfDocs) if (!d.defaultView) this.pdfDocs.delete(i)
    const root = doc.documentElement
    root.querySelector(`.${MARKS_CLASS}`)?.remove()
    const mine = this.list.filter((h) => this.indexOf(h.cfi) === index)
    if (!mine.length) return
    // After the body, so the body's place — which every CFI in the page goes through — is kept.
    const layer = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    layer.className = MARKS_CLASS
    layer.setAttribute('aria-hidden', 'true')
    root.appendChild(layer)
    const base = root.getBoundingClientRect()
    // The page's root is scaled down by the screen's pixel ratio; boxes inside it are scaled with it.
    const scale = base.width ? root.offsetWidth / base.width : 1
    for (const h of mine) {
      const range = this.rangeIn(doc, h.cfi)
      if (!range) continue
      for (const rect of Array.from(range.getClientRects())) {
        const box = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div')
        box.className = `${MARKS_CLASS}__box`
        box.dataset.cfi = h.cfi
        box.style.setProperty('left', `${(rect.left - base.left) * scale}px`)
        box.style.setProperty('top', `${(rect.top - base.top) * scale}px`)
        box.style.setProperty('width', `${rect.width * scale}px`)
        box.style.setProperty('height', `${rect.height * scale}px`)
        box.style.setProperty('background-color', markColor(this.themeEl, h.color))
        layer.appendChild(box)
      }
    }
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
    for (const box of Array.from(doc.querySelectorAll<HTMLElement>(`.${MARKS_CLASS}__box`))) {
      const r = box.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return this.list.find((h) => h.cfi === box.dataset.cfi) ?? null
    }
    return null
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
