/**
 * What Abele puts around a PDF page (`src/reader/pdfBook.ts`), which PDF.js does not decide:
 * the page document, its policy, where links may go, and whether Obsidian's PDF.js will do.
 * Drawing real PDFs is the e2e tier's (`tests/e2e/bookPdf.e2e.test.ts`): PDF.js is Obsidian's.
 */
import { describe, it, expect } from 'vitest'
import { checkPdfLib, pdfDataUrls, pdfLinkService, pdfPageHtml } from '@/reader/pdfBook'
import { auditDocument } from '@/reader/bookSafety'
import { swipeDirection } from '@/reader/swipe'
import { setPdfTakeover } from '@/reader/pdfTakeover'

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
