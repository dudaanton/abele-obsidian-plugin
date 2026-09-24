/**
 * A PDF as a book the engine can draw: one fixed-layout page per PDF page, drawn by PDF.js.
 *
 * Adapted from foliate-js's `pdf.js` adapter (MIT, commit 78914ae), which its author calls a
 * proof of concept. What changed, and why:
 *
 * - **PDF.js is Obsidian's own**, from `loadPdfJs()`: nothing is added to the plugin, the worker is
 *   the one Obsidian already runs, and the same library is there on the phone.
 * - **Nothing in a PDF runs.** PDF.js runs no PDF JavaScript unless it is given a scripting
 *   sandbox, which it is not; `isEvalSupported` is off, so no font is compiled with `eval`; XFA
 *   forms and form fields are not drawn. A page is a page Abele writes, with the same Content
 *   Security Policy as a book's, audited like one when it loads; the PDF supplies only a picture
 *   (a canvas) and text put in with `textContent`. A link to outside the document gets an address
 *   only if it is `http(s):` or `mailto:`.
 * - Links inside the document go to their page; the contents come from the PDF's outline.
 */
import { BOOK_CSP, CSP_MARK, XHTML_NS, isOpenableExternal } from './bookSafety'
import type { FoliateBook, FoliateSection, FoliateTocItem } from '@/vendor/foliate-js/view.js'
import textLayerCss from '@/vendor/pdfjs-css/text_layer_builder.css?raw'
import annotationLayerCss from '@/vendor/pdfjs-css/annotation_layer_builder.css?raw'
import type { OpenedBook } from './openBook'
import { search, type SearchExcerpt } from '@/vendor/foliate-js/search.js'

/** A page of a PDF that has been drawn, or drawn again at a new size: its text layer is fresh. */
export interface PdfPageDrawn {
  doc: Document
  index: number
}

/** What a search of a PDF finds on one page: the page, and each match's place among the page's. */
export interface PdfSearchPage {
  index: number
  items: { occurrence: number; excerpt: SearchExcerpt }[]
}

/** The extra a PDF book carries: its pages' drawing events, and a search through its text. */
export interface PdfBookExtras {
  pageEvents: EventTarget
  searchPages(
    query: string,
    isCancelled: () => boolean
  ): AsyncGenerator<PdfSearchPage | { progress: number }>
  /** A page's words, lines as the PDF breaks them. */
  pageText(index: number): Promise<string>
}

/* The parts of PDF.js this uses, typed loosely: it is Obsidian's copy, of Obsidian's version. */
type PdfLib = any
type PdfDocument = any
type PdfPage = any

/** What the library must have for this adapter; a copy without it is too old. */
export function checkPdfLib(lib: PdfLib): string | null {
  if (!lib) return 'PDF.js is not available in this version of Obsidian.'
  for (const name of ['getDocument', 'TextLayer', 'AnnotationLayer', 'PDFDataRangeTransport'])
    if (!lib[name]) return `This version of Obsidian ships an older PDF.js (no ${name}).`
  return null
}

/** Where the library's data files are, beside its worker: character maps, fonts, decoders. */
export function pdfDataUrls(workerSrc: string | undefined): Record<string, string> {
  if (!workerSrc) return {}
  const base = workerSrc.replace(/[^/]*$/, '')
  return {
    cMapUrl: `${base}cmaps/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
  }
}

/** The page document Abele writes for one PDF page: its size, the policy, the layers' styles. */
export function pdfPageHtml(width: number, height: number): string {
  const w = Math.round(width * 1000) / 1000
  const h = Math.round(height * 1000) / 1000
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta http-equiv="Content-Security-Policy" content="${BOOK_CSP}" ${CSP_MARK}="">
<meta charset="utf-8">
<meta name="viewport" content="width=${w}, height=${h}">
<style>
html, body { margin: 0; padding: 0; }
:root { --user-unit: 1; --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
  --scale-round-x: 1px; --scale-round-y: 1px; }
${textLayerCss}
${annotationLayerCss}
.abele-marks { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
.abele-marks__box { position: absolute; opacity: 0.35; mix-blend-mode: multiply; border-radius: 2px; }
</style></head>
<body><div id="canvas"></div><div class="textLayer"></div><div class="annotationLayer"></div></body>
</html>`
}

/** Where a link in a PDF may send the reader. Internal destinations go through `href` as JSON. */
export function pdfLinkService(): Record<string, unknown> {
  return {
    externalLinkEnabled: true,
    goToDestination: () => {},
    executeNamedAction: () => {},
    executeSetOCGState: () => {},
    getDestinationHash: (dest: unknown) => JSON.stringify(dest),
    getAnchorUrl: () => '#',
    addLinkAttributes: (link: HTMLAnchorElement, url: string) => {
      if (isOpenableExternal(url)) link.href = url
      else link.removeAttribute('href')
    },
    isPageVisible: () => true,
    isPageCached: () => true,
  }
}

const tocItem = (item: { title?: string; dest?: unknown; items?: unknown[] }): FoliateTocItem => ({
  label: item.title ?? '',
  href: JSON.stringify(item.dest ?? null),
  subitems: item.items?.length
    ? (item.items as { title?: string; dest?: unknown; items?: unknown[] }[]).map(tocItem)
    : undefined,
})

async function drawPage(
  lib: PdfLib,
  page: PdfPage,
  doc: Document,
  zoom: number,
  current: () => boolean
): Promise<void> {
  const ratio = doc.defaultView?.devicePixelRatio ?? 1
  const scale = zoom * ratio
  // The page frame is a document of its own, which Obsidian's element helpers do not reach.
  const root = doc.documentElement.style
  root.setProperty('transform', `scale(${1 / ratio})`)
  root.setProperty('transform-origin', 'top left')
  root.setProperty('--scale-factor', String(scale))
  const viewport = page.getViewport({ scale })

  // Drawn on a canvas in the app's document, where PDF.js loaded the page's fonts, and shown in
  // the page as a picture: a page frame that may run no script shows a canvas as nothing at all.
  const canvas = activeWindow.createEl('canvas')
  canvas.height = viewport.height
  canvas.width = viewport.width
  await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise
  if (!current()) return
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = canvas.height = 0
  if (!blob || !current()) return
  const img = doc.createElementNS(XHTML_NS, 'img') as HTMLImageElement
  img.alt = ''
  img.width = viewport.width
  img.height = viewport.height
  img.src = URL.createObjectURL(blob)
  const holder = doc.querySelector('#canvas')
  const previous = holder?.querySelector('img')?.src
  holder?.replaceChildren(img)
  if (previous) URL.revokeObjectURL(previous)

  const container = doc.querySelector('.textLayer')
  if (container) {
    container.replaceChildren()
    const textLayer = new lib.TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    })
    await textLayer.render()
    const end = doc.createElementNS(XHTML_NS, 'div')
    end.className = 'endOfContent'
    container.append(end)
  }
  // PDF.js hides the canvases it measures text on in the app's document; keep them hidden.
  for (const hidden of Array.from(activeDocument.querySelectorAll('.hiddenCanvasElement')))
    (hidden as HTMLElement).addClass('abele-book__pdf-hidden')

  const layer = doc.querySelector('.annotationLayer')
  if (layer) {
    layer.replaceChildren()
    await new lib.AnnotationLayer({ page, viewport, div: layer }).render({
      annotations: await page.getAnnotations({ intent: 'display' }),
      linkService: pdfLinkService(),
      renderForms: false,
      enableScripting: false,
      hasJSActions: false,
    })
  }
}

export async function openPdf(lib: PdfLib, data: Uint8Array): Promise<OpenedBook> {
  const problem = checkPdfLib(lib)
  if (problem) throw new Error(problem)
  const pdf: PdfDocument = await lib.getDocument({
    data,
    ...pdfDataUrls(lib.GlobalWorkerOptions?.workerSrc),
    isEvalSupported: false,
    enableXfa: false,
    enableScripting: false,
    disableAutoFetch: true,
  }).promise

  const meta = (await pdf.getMetadata().catch((): null => null)) ?? {}
  const get = (key: string): unknown => meta.metadata?.get?.(key)
  const outline: { title?: string; dest?: unknown; items?: unknown[] }[] | null = await pdf
    .getOutline()
    .catch((): null => null)

  const pageEvents = new EventTarget()
  const urls = new Map<number, string>()
  const pages = new Map<
    number,
    { src: string; onZoom: (z: { doc: Document; scale: number }) => void }
  >()
  /** The drawing a page frame last asked for; an older one still finishing is dropped. */
  const drawing = new WeakMap<Document, number>()
  /** The size each page frame was last drawn at. */
  const drawnAt = new WeakMap<Document, number>()
  const sections: FoliateSection[] = Array.from({ length: pdf.numPages as number }, (_, i) => ({
    id: i,
    size: 1000,
    load: async () => {
      const cached = pages.get(i)
      if (cached) return cached as unknown as string
      const page: PdfPage = await pdf.getPage(i + 1)
      const { width, height } = page.getViewport({ scale: 1 })
      const url = URL.createObjectURL(new Blob([pdfPageHtml(width, height)], { type: 'text/html' }))
      urls.set(i, url)
      const onZoom = ({ doc, scale }: { doc: Document; scale: number }): void => {
        // Asked again at the size it already has — the engine lays out more often than sizes
        // change — it is left alone: drawing it again would replace its text, and lose a selection.
        if (drawnAt.get(doc) === scale) return
        drawnAt.set(doc, scale)
        const turn = (drawing.get(doc) ?? 0) + 1
        drawing.set(doc, turn)
        void drawPage(lib, page, doc, scale, () => drawing.get(doc) === turn)
          .then(() => {
            if (drawing.get(doc) === turn)
              pageEvents.dispatchEvent(
                new CustomEvent<PdfPageDrawn>('drawn', { detail: { doc, index: i } })
              )
          })
          .catch((e) => console.warn('[Abele] a PDF page could not be drawn', e))
      }
      const entry = { src: url, onZoom }
      pages.set(i, entry)
      return entry as unknown as string
    },
    unload: () => {},
  }))

  const destIndex = async (href: string): Promise<number> => {
    const parsed: unknown = JSON.parse(href)
    const dest = typeof parsed === 'string' ? await pdf.getDestination(parsed) : parsed
    if (!Array.isArray(dest)) throw new Error('No such place in this PDF')
    const ref = dest[0]
    return typeof ref === 'number' ? ref : ((await pdf.getPageIndex(ref)) as number)
  }

  async function* searchPages(
    query: string,
    isCancelled: () => boolean
  ): AsyncGenerator<PdfSearchPage | { progress: number }> {
    const total = pdf.numPages as number
    for (let i = 0; i < total; i++) {
      if (isCancelled()) return
      const page: PdfPage = await pdf.getPage(i + 1)
      const content = await page.getTextContent()
      const strs: string[] = (content.items as { str?: string }[]).map((item) => item.str ?? '')
      const items = Array.from(
        search(strs, query, { locales: 'en', granularity: 'grapheme', sensitivity: 'base' }),
        (found, occurrence) => ({ occurrence, excerpt: found.excerpt })
      )
      if (items.length) yield { index: i, items }
      yield { progress: (i + 1) / total }
    }
  }

  /** A page's words, lines as the PDF breaks them. */
  async function pageText(index: number): Promise<string> {
    const page: PdfPage = await pdf.getPage(index + 1)
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      text += item.str ?? ''
      if (item.hasEOL) text += '\n'
    }
    return text.replace(/[ \t]+\n/g, '\n').trim()
  }

  const book: FoliateBook & PdfBookExtras = {
    pageEvents,
    searchPages,
    pageText,
    rendition: { layout: 'pre-paginated' },
    metadata: {
      title: get('dc:title') ?? meta.info?.Title,
      author: get('dc:creator') ?? meta.info?.Author,
      identifier: get('dc:identifier'),
      language: get('dc:language'),
    },
    toc: outline?.map(tocItem),
    sections,
    isExternal: (uri: string) => /^\w+:/i.test(uri),
    resolveHref: async (href: string) => ({ index: await destIndex(href) }),
    splitTOCHref: async (href: string) => [await destIndex(href), null],
    getTOCFragment: (doc: Document) => doc.documentElement,
  }
  return {
    book,
    destroy: () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
      pages.clear()
      void pdf.destroy()
    },
  }
}
