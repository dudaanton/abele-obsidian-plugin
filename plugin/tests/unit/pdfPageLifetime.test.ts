import { afterEach, expect, it, vi } from 'vitest'
import { openPdf, pdfPageHtml } from '@/reader/pdfBook'
import { deferred } from '../helpers/deferred'
import { definePdfScroll, PDF_SCROLL_TAG, PdfScroll } from '@/reader/pdfScroll'
import { tagName } from '@/vendor/foliate-js/elements.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function open(render = Promise.resolve(), count = 1) {
  let serial = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:sample-${++serial}`)
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined)
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(null)
  vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(new Blob(['sample pixels'])))
  vi.stubGlobal('activeWindow', { createEl: () => canvas })
  vi.stubGlobal('activeDocument', document)
  const page = {
    getViewport: () => ({ width: 600, height: 800 }),
    render: () => ({ promise: render }),
    streamTextContent: () => ({}),
    getAnnotations: async () => [],
    cleanup: vi.fn(),
  }
  const pdf = {
    numPages: count,
    getMetadata: async () => ({}),
    getOutline: async () => [],
    getPage: async () => page,
    destroy: vi.fn(),
  }
  const lib = {
    getDocument: () => ({ promise: Promise.resolve(pdf) }),
    PDFDataRangeTransport: class {},
    TextLayer: class {
      render = async () => {}
    },
    AnnotationLayer: class {
      render = async () => {}
    },
  }
  const opened = await openPdf(lib, new Uint8Array())
  return { opened, revoke, canvas, page }
}

it.each(['scroll', 'pages'] as const)(
  'releases pictures through the %s renderer when navigation removes a real page frame',
  async (layout) => {
    const { opened, revoke } = await open(Promise.resolve(), 8)
    const attach = HTMLElement.prototype.attachShadow
    vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (options) {
      return attach.call(this, { ...options, mode: 'open' })
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 624,
      height: 800,
      right: 624,
      bottom: 800,
      toJSON: () => ({}),
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(624)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
      return parseFloat(this.style.height) || 800
    })
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function () {
      return this.classList.contains('slot')
        ? [...this.parentElement!.children].indexOf(this) * 812
        : 0
    })
    vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (src) {
      Object.defineProperty(this, 'src', { value: src, writable: true, configurable: true })
      const doc = new DOMParser().parseFromString(pdfPageHtml(600, 800), 'text/html')
      Object.defineProperty(doc, 'URL', { value: src })
      Object.defineProperty(this, 'contentDocument', { value: doc, configurable: true })
      queueMicrotask(() => this.dispatchEvent(new Event('load')))
    })
    const settings = window.happyDOM.settings
    const iframeLoading = settings.disableIframePageLoading
    settings.disableIframePageLoading = true
    definePdfScroll(window)
    await import('@/vendor/foliate-js/fixed-layout.js')
    opened.book.rendition!.spread = 'none'
    const renderer = document.createElement(
      layout === 'scroll' ? PDF_SCROLL_TAG : tagName('foliate-fxl')
    ) as PdfScroll
    document.body.append(renderer)
    try {
      renderer.open(opened.book)
      await renderer.goTo({ index: 0 })
      await vi.waitFor(() =>
        expect(renderer.getContents()[0]?.doc.querySelector('img')).toBeTruthy()
      )
      const first = renderer.getContents()[0].doc
      const picture = first.querySelector('img')!.src
      const frameUrl = renderer.shadowRoot!.querySelector<HTMLIFrameElement>('iframe')!.src
      if (layout === 'pages') {
        await renderer.goTo({ index: 0 })
        await vi.waitFor(() =>
          expect(renderer.getContents()[0]?.doc.querySelector('img')).toBeTruthy()
        )
        expect(revoke.mock.calls.some(([url]) => url === frameUrl)).toBe(false)
      }
      await renderer.goTo({ index: 6 })
      expect(renderer.getContents().some((content) => content.doc === first)).toBe(false)
      expect(revoke).toHaveBeenCalledWith(picture)
      expect(revoke).toHaveBeenCalledWith(frameUrl)
      expect(first.querySelector('img')).toBeNull()
    } finally {
      renderer.destroy()
      renderer.remove()
      opened.destroy()
      settings.disableIframePageLoading = iframeLoading
    }
  }
)

it('releases the page picture and its frame URL when the section leaves the screen', async () => {
  const { opened, revoke } = await open()
  const section = opened.book.sections[0]
  const entry = (await section.load()) as unknown as {
    src: string
    onZoom(value: { doc: Document; scale: number }): void
  }
  const doc = new DOMParser().parseFromString(pdfPageHtml(600, 800), 'text/html')
  const drawn = new Promise<void>((resolve) =>
    (opened.book as unknown as { pageEvents: EventTarget }).pageEvents.addEventListener(
      'drawn',
      () => resolve(),
      { once: true }
    )
  )
  entry.onZoom({ doc, scale: 1 })
  await drawn
  const picture = doc.querySelector('img')!.src
  section.unload?.()
  expect(revoke).toHaveBeenCalledWith(picture)
  expect(revoke).toHaveBeenCalledWith(entry.src)
  const next = (await section.load()) as unknown as { src: string }
  expect(next.src).not.toBe(entry.src)
  opened.destroy()
})

it('does not publish or retain a picture whose render finishes after unload', async () => {
  const render = deferred<void>()
  const { opened, canvas } = await open(render.promise)
  const section = opened.book.sections[0]
  const entry = (await section.load()) as unknown as {
    onZoom(value: { doc: Document; scale: number }): void
  }
  const doc = new DOMParser().parseFromString(pdfPageHtml(600, 800), 'text/html')
  entry.onZoom({ doc, scale: 1 })
  section.unload?.()
  render.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(doc.querySelector('img')).toBeNull()
  expect(canvas.width).toBe(0)
  opened.destroy()
})
