/**
 * Books in the formats other than EPUB and PDF that the engine reads: MOBI and Kindle's AZW3,
 * FictionBook (FB2, and FB2 zipped as FBZ) and comic book archives (CBZ).
 *
 * The engine builds these books' pages itself, and not every format sends its pages through a
 * hook the reader can clean on the way. So every page of them is taken as the engine made it and
 * cleaned before a frame may open it: read back from the address the engine gave it, rebuilt by
 * the same cleaning an EPUB's pages get — scripts, handlers and runnable links out, the Content
 * Security Policy first in its head — and handed to the frame from an address of its own. Pages
 * parsed for reading (search, the agent) are cleaned the same way. The frame audit then checks
 * them as it checks every page.
 */
import { unzlibSync } from 'fflate'
import { MOBI } from '@/vendor/foliate-js/mobi.js'
import { makeFB2 } from '@/vendor/foliate-js/fb2.js'
import { makeComicBook } from '@/vendor/foliate-js/comic-book.js'
import type { FoliateBook } from '@/vendor/foliate-js/view.js'
import { MIME, cleanDocument, guardBook, injectPolicy, sanitizePage } from './bookSafety'
import { isZip, openZip } from './zipLoader'
import { BookFormatError, type OpenedBook } from './openBook'

/** Which reader opens a file, by its extension. */
export type BookFormat = 'epub' | 'pdf' | 'mobi' | 'fb2' | 'fbz' | 'cbz'

export function formatOf(extension: string): BookFormat | null {
  switch (extension.toLowerCase()) {
    case 'epub':
      return 'epub'
    case 'pdf':
      return 'pdf'
    case 'mobi':
    case 'azw':
    case 'azw3':
    case 'prc':
      return 'mobi'
    case 'fb2':
      return 'fb2'
    case 'fbz':
      return 'fbz'
    case 'cbz':
      return 'cbz'
    default:
      return null
  }
}

/** A Mobipocket or Kindle file's DRM: the PalmDOC header's encryption field, read before opening. */
export function mobiEncryption(data: Uint8Array): number {
  if (data.length < 86) return 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const magic = String.fromCharCode(...data.subarray(60, 68))
  if (magic !== 'BOOKMOBI' && magic !== 'TEXtREAd') return 0
  const record0 = view.getUint32(78)
  if (record0 + 14 > data.length) return 0
  return view.getUint16(record0 + 12)
}

/** Every page of the book cleaned before a frame may open it; see the file comment. */
export function cleanSections(book: FoliateBook): () => void {
  const urls = new Map<number, string>()
  book.sections.forEach((section, index) => {
    const load = section.load.bind(section)
    section.load = async () => {
      const cached = urls.get(index)
      if (cached) return cached
      const made = await load()
      if (typeof made !== 'string' || !made) return made
      const response = await window.fetch(made)
      const type = response.headers.get('content-type') || MIME.HTML
      const clean = sanitizePage(await response.text(), type)
      const url = URL.createObjectURL(new Blob([clean.data], { type: clean.type }))
      urls.set(index, url)
      return url
    }
    const unload = section.unload?.bind(section)
    section.unload = () => {
      const url = urls.get(index)
      if (url) URL.revokeObjectURL(url)
      urls.delete(index)
      unload?.()
    }
    const create = section.createDocument?.bind(section)
    if (create)
      section.createDocument = async () => {
        const doc = await create()
        cleanDocument(doc)
        injectPolicy(doc)
        return doc
      }
  })
  return () => {
    for (const url of urls.values()) URL.revokeObjectURL(url)
    urls.clear()
  }
}

const opened = (book: FoliateBook): OpenedBook => {
  // Resources a format does send through the engine's hook (a Kindle book's styles and pictures)
  // are cleaned there as an EPUB's are.
  if (book.transformTarget) guardBook(book)
  const release = cleanSections(book)
  return {
    book,
    destroy: () => {
      release()
      ;(book as { destroy?: () => void }).destroy?.()
    },
  }
}

export async function openOtherFormat(
  format: Exclude<BookFormat, 'epub' | 'pdf'>,
  name: string,
  data: Uint8Array
): Promise<OpenedBook> {
  const blob = new Blob([data as BlobPart])
  switch (format) {
    case 'mobi': {
      if (mobiEncryption(data))
        throw new BookFormatError('This book is protected by DRM, and the reader cannot open it.')
      const file = new File([blob], name)
      return opened(await new MOBI({ unzlib: unzlibSync }).open(file))
    }
    case 'fb2':
      return opened(
        await makeFB2(new File([blob], name, { type: 'application/x-fictionbook+xml' }))
      )
    case 'fbz': {
      if (!isZip(data)) throw new BookFormatError('This file is not a zipped FB2 book.')
      const zip = openZip(data)
      const entry = zip.entries.find((e) => e.filename.toLowerCase().endsWith('.fb2'))
      const inner = entry && zip.loadBlob(entry.filename)
      if (!inner) throw new BookFormatError('There is no FB2 book in this archive.')
      return opened(await makeFB2(inner))
    }
    case 'cbz': {
      if (!isZip(data)) throw new BookFormatError('This file is not a comic book archive.')
      return opened(makeComicBook(openZip(data), { name }))
    }
  }
}
