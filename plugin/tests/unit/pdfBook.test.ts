/**
 * What Abele puts around a PDF page (`src/reader/pdfBook.ts`), which PDF.js does not decide:
 * the page document, its policy, where links may go, and whether Obsidian's PDF.js will do.
 * Drawing real PDFs is the e2e tier's (`tests/e2e/bookPdf.e2e.test.ts`): PDF.js is Obsidian's.
 */
import { describe, it, expect, vi } from 'vitest'
import { checkPdfLib, pdfDataUrls, pdfLinkService, pdfPageHtml } from '@/reader/pdfBook'
import { auditDocument } from '@/reader/bookSafety'
import { swipeDirection } from '@/reader/swipe'
import { adoptPdfLeaves, setPdfTakeover } from '@/reader/pdfTakeover'

describe('the page Abele writes for a PDF page', () => {
  it('has the policy first, the size of the page, and passes the audit', () => {
    const html = pdfPageHtml(612, 792.0004)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe(
      'width=612, height=792'
    )
    expect(auditDocument(doc)).toEqual([])
    expect(html).toContain('.textLayer')
    expect(html).toContain('.annotationLayer')
  })
})

describe('links in a PDF', () => {
  const link = (url: string) => {
    const a = document.createElement('a')
    ;(pdfLinkService().addLinkAttributes as (a: HTMLAnchorElement, u: string) => void)(a, url)
    return a.getAttribute('href')
  }

  it('lead out only to the web and to mail', () => {
    expect(link('https://example.com/x')).toBe('https://example.com/x')
    expect(link('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(link('javascript:app.vault.adapter.remove("x")')).toBeNull()
    expect(link('file:///etc/passwd')).toBeNull()
    expect(link('obsidian://open?vault=x')).toBeNull()
  })

  it('carry a place inside the document as its destination, which the book resolves to a page', () => {
    const hash = (pdfLinkService().getDestinationHash as (d: unknown) => string)([
      { num: 5, gen: 0 },
      { name: 'XYZ' },
    ])
    expect(JSON.parse(hash)).toEqual([{ num: 5, gen: 0 }, { name: 'XYZ' }])
  })
})

describe("Obsidian's PDF.js", () => {
  const complete = {
    getDocument: () => {},
    TextLayer: class {},
    AnnotationLayer: class {},
    PDFDataRangeTransport: class {},
  }

  it('will do when it has the layers this draws with', () => {
    expect(checkPdfLib(complete)).toBeNull()
  })

  it('is refused, with a reason, when it is missing or too old', () => {
    expect(checkPdfLib(null)).toMatch(/not available/)
    expect(checkPdfLib({ ...complete, TextLayer: undefined })).toMatch(
      /older PDF.js \(no TextLayer\)/
    )
  })

  it('has its data files beside its worker', () => {
    expect(pdfDataUrls('app://obsidian.md/lib/pdfjs/pdf.worker.min.mjs')).toEqual({
      cMapUrl: 'app://obsidian.md/lib/pdfjs/cmaps/',
      standardFontDataUrl: 'app://obsidian.md/lib/pdfjs/standard_fonts/',
      wasmUrl: 'app://obsidian.md/lib/pdfjs/wasm/',
      iccUrl: 'app://obsidian.md/lib/pdfjs/iccs/',
    })
    expect(pdfDataUrls(undefined)).toEqual({})
  })
})

describe('a swipe', () => {
  it('is quick, mostly sideways and long enough', () => {
    expect(swipeDirection({ x: 300, y: 100, t: 0 }, { x: 100, y: 110, t: 200 })).toBe('left')
    expect(swipeDirection({ x: 100, y: 100, t: 0 }, { x: 300, y: 90, t: 200 })).toBe('right')
    expect(swipeDirection({ x: 300, y: 100, t: 0 }, { x: 290, y: 100, t: 100 })).toBeNull()
    expect(swipeDirection({ x: 300, y: 100, t: 0 }, { x: 200, y: 300, t: 100 })).toBeNull()
    expect(swipeDirection({ x: 300, y: 100, t: 0 }, { x: 100, y: 100, t: 2000 })).toBeNull()
  })
})

describe('PDFs opening in the reader', () => {
  const registry = () => {
    const typeByExtension: Record<string, string> = { pdf: 'pdf', md: 'markdown' }
    return {
      typeByExtension,
      registerExtensions: (exts: string[], type: string) => {
        for (const e of exts) {
          if (typeByExtension[e]) throw new Error('taken')
          typeByExtension[e] = type
        }
      },
      unregisterExtensions: (exts: string[]) => {
        for (const e of exts) delete typeByExtension[e]
      },
    }
  }

  it("take .pdf from Obsidian's viewer while on, and give it back when off", () => {
    const viewRegistry = registry()
    const app = { viewRegistry }
    expect(setPdfTakeover(app, true, 'abele-book')).toBe(true)
    expect(viewRegistry.typeByExtension.pdf).toBe('abele-book')
    // Asking again changes nothing.
    setPdfTakeover(app, true, 'abele-book')
    expect(viewRegistry.typeByExtension.pdf).toBe('abele-book')
    setPdfTakeover(app, false, 'abele-book')
    expect(viewRegistry.typeByExtension.pdf).toBe('pdf')
    expect(viewRegistry.typeByExtension.md).toBe('markdown')
  })

  it('leave a registry it does not recognise alone', () => {
    expect(setPdfTakeover({}, true, 'abele-book')).toBe(false)
  })

  it("move PDFs already open in Obsidian's viewer — tabs restored at start — into the reader", async () => {
    const leaf = (type: string, file?: string) => {
      let state: { type: string; state?: Record<string, unknown>; pinned?: boolean } = {
        type,
        state: file ? { file, page: 3 } : {},
        pinned: true,
      }
      return {
        getViewState: () => state,
        setViewState: vi.fn(async (next: typeof state) => {
          state = next
        }),
      }
    }
    const pdf = leaf('pdf', 'Books/a.pdf')
    const note = leaf('markdown', 'a.md')
    const empty = leaf('pdf')
    const reader = leaf('abele-book', 'Books/b.pdf')
    const app = {
      workspace: {
        iterateAllLeaves: (fn: (l: unknown) => void) => [pdf, note, empty, reader].forEach(fn),
      },
    }
    expect(await adoptPdfLeaves(app, 'abele-book')).toBe(1)
    expect(pdf.setViewState).toHaveBeenCalledWith({
      type: 'abele-book',
      state: { file: 'Books/a.pdf' },
      pinned: true,
    })
    for (const l of [note, empty, reader]) expect(l.setViewState).not.toHaveBeenCalled()
    // Nothing to walk: nothing done.
    expect(await adoptPdfLeaves({}, 'abele-book')).toBe(0)
  })
})

describe('the hostile test PDF', () => {
  it('does carry what the e2e tier proves is never run', async () => {
    const { buildHostilePdf } = await import('../fixtures/books/pdfFixture')
    const text = new TextDecoder('latin1').decode(buildHostilePdf())
    expect(text).toContain('/OpenAction << /S /JavaScript')
    expect(text).toContain('/S /URI /URI (javascript:')
    expect(text).toContain('/S /Launch')
    expect(text).toContain('/AA << /K << /S /JavaScript')
    expect(text).toContain('/Names << /JavaScript')
  })
})

describe('zooming a PDF', () => {
  it('steps up and down through the scales, from whatever a fitted page was', async () => {
    const { zoomStep } = await import('@/reader/zoom')
    expect(zoomStep(1, true)).toBe(1.1)
    expect(zoomStep(1, false)).toBe(0.9)
    expect(zoomStep(1.37, true)).toBe(1.5)
    expect(zoomStep(1.37, false)).toBe(1.25)
    expect(zoomStep(4, true)).toBe(4)
    expect(zoomStep(0.25, false)).toBe(0.25)
  })
})

describe('a PDF as one scroll', () => {
  it('fits a page to the column or the screen, or takes a fixed zoom', async () => {
    const { pageScale } = await import('@/reader/pdfScroll')
    const page = { width: 600, height: 800 }
    // Column 1224 wide less the gaps: 2×; the screen 824 tall less the gaps: 1×.
    expect(pageScale('fit-width', page, 1224, 824)).toBe(2)
    expect(pageScale('fit-page', page, 1224, 824)).toBe(1)
    expect(pageScale('1.5', page, 1224, 824)).toBe(1.5)
    // Never blown up past three times on a wide screen.
    expect(pageScale('fit-width', page, 3000, 824)).toBe(3)
  })

  it('reads which page a place in the scroll is in, and how far down it', async () => {
    const { pageAt } = await import('@/reader/pdfScroll')
    const tops = [12, 824, 1636]
    const heights = [800, 800, 800]
    expect(pageAt(tops, heights, 0)).toEqual({ index: 0, fraction: 0 })
    expect(pageAt(tops, heights, 412)).toEqual({ index: 0, fraction: 0.5 })
    expect(pageAt(tops, heights, 1636 + 200)).toEqual({ index: 2, fraction: 0.25 })
    expect(pageAt(tops, heights, 9999).index).toBe(2)
  })
})
