import { afterEach, expect, it, vi } from 'vitest'
import { openPdf, pdfPageHtml } from '@/reader/pdfBook'
import { deferred } from '../helpers/deferred'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function open(render = Promise.resolve()) {
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
    numPages: 1,
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
