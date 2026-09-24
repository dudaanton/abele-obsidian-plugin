/**
 * From the bytes of a book file to a book object the engine can draw — cleaned on the way.
 *
 * The engine's own `makeBook` is not used for archives: Abele reads them with fflate
 * (`zipLoader.ts`) and hands the engine a finished book, so every resource passes through
 * `guardBook` before any frame can open it.
 */
import { EPUB } from '@/vendor/foliate-js/epub.js'
import type { FoliateBook } from '@/vendor/foliate-js/view.js'
import {
  MIME,
  cleanDocument,
  guardBook,
  injectPolicy,
  resourcePolicy,
  sanitizePage,
} from './bookSafety'
import { isZip, openZip, type ZipLoader } from './zipLoader'

export class BookFormatError extends Error {}

/**
 * Pages parsed for reading rather than drawing — search, the table of contents, and later the
 * agent — are cleaned the same way, so a position found in one is the same element in the other.
 */
function cleanParsedPages(book: EPUB): void {
  const load = book.loadDocument.bind(book)
  book.loadDocument = async (item: unknown) => {
    const doc = await load(item)
    cleanDocument(doc)
    injectPolicy(doc)
    return doc
  }
}

/** What stands in for a chapter in a format no page can be safely drawn from. */
const UNSHOWN_CHAPTER = sanitizePage(
  '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Not shown</title></head>' +
    '<body><p>This part of the book is in a format the reader does not show.</p></body></html>',
  MIME.XHTML
).data

interface ManifestItem {
  href: string
  mediaType?: string
}

/** A page showing one picture of the book, the way a chapter that is an SVG image is shown. */
const pictureChapter = (src: string) =>
  sanitizePage(
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Picture</title></head>' +
      '<body style="margin:0;display:flex;align-items:center;justify-content:center">' +
      '<img alt="" style="max-width:100%;max-height:100vh" src="' +
      src.replace(/[&"<]/g, '') +
      '"/></body></html>',
    MIME.XHTML
  ).data

/**
 * Chapters that are not pages get pages of their own.
 *
 * - An SVG chapter is shown as a picture on a page: the engine lays out only pages with a body,
 *   and a picture in an `img` can never run anything, whatever the cleaning missed.
 * - A chapter declared as anything else — plain XML, say — would reach its frame as bytes nothing
 *   renders, and the engine would wait for a page that never loads. It gets a page saying so.
 */
function replaceChaptersThatAreNotPages(book: EPUB): () => void {
  const resources = book.resources as
    | { getItemByHref?: (href: string) => ManifestItem | undefined }
    | undefined
  const urls = new Set<string>()
  const pageUrl = (xhtml: string) => {
    const url = URL.createObjectURL(new Blob([xhtml], { type: MIME.XHTML }))
    urls.add(url)
    return url
  }
  let unshown: string | null = null
  for (const section of book.sections) {
    const item = resources?.getItemByHref?.(typeof section.id === 'string' ? section.id : '')
    const policy = resourcePolicy(item?.mediaType)
    if (policy === 'page') continue
    if (policy === 'svg') {
      const loadPicture = section.load.bind(section)
      const unloadPicture = section.unload?.bind(section)
      let page: string | null = null
      section.load = async () => (page ??= pageUrl(pictureChapter(await loadPicture())))
      section.unload = () => {
        if (page) URL.revokeObjectURL(page)
        urls.delete(page ?? '')
        page = null
        unloadPicture?.()
      }
      continue
    }
    section.load = () => (unshown ??= pageUrl(UNSHOWN_CHAPTER))
    section.unload = () => {}
    section.createDocument = () => new DOMParser().parseFromString(UNSHOWN_CHAPTER, MIME.XHTML)
  }
  return () => {
    for (const url of urls) URL.revokeObjectURL(url)
    urls.clear()
  }
}

export interface OpenedBook {
  book: FoliateBook
  /** Frees the URLs the engine made for the book's resources. */
  destroy(): void
}

/** Font obfuscation, the one kind of "encryption" an ordinary book carries. */
const FONT_OBFUSCATION = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
])

/**
 * Whether the book is protected by DRM: anything encrypted with other than font obfuscation, or
 * the rights files Adobe and Apple put in protected books.
 */
export function isProtected(zip: ZipLoader): boolean {
  const names = new Set(zip.entries.map((e) => e.filename))
  if (names.has('META-INF/rights.xml') || names.has('META-INF/sinf.xml')) return true
  const encryption = zip.loadText('META-INF/encryption.xml')
  if (!encryption) return false
  const algorithms = Array.from(
    encryption.matchAll(/EncryptionMethod[^>]*\sAlgorithm\s*=\s*["']([^"']+)["']/g),
    (m) => m[1]
  )
  return algorithms.some((a) => !FONT_OBFUSCATION.has(a))
}

export async function openEpub(data: Uint8Array): Promise<OpenedBook> {
  if (!isZip(data)) throw new BookFormatError('This file is not an EPUB book.')
  const zip: ZipLoader = openZip(data)
  if (!zip.entries.some((e) => e.filename === 'META-INF/container.xml'))
    throw new BookFormatError('This file is not an EPUB book: it has no container.')
  if (isProtected(zip))
    throw new BookFormatError('This book is protected by DRM, and the reader cannot open it.')
  const epub = new EPUB({
    loadText: zip.loadText,
    loadBlob: zip.loadBlob,
    getSize: zip.getSize,
  })
  const book = await epub.init()
  guardBook(book)
  cleanParsedPages(book)
  const releasePlaceholders = replaceChaptersThatAreNotPages(book)
  return {
    book,
    destroy: () => {
      releasePlaceholders()
      ;(book as unknown as { destroy?: () => void }).destroy?.()
    },
  }
}
