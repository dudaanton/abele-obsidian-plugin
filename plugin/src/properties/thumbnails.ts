/**
 * The small picture on a file card: the image itself, a book's cover, a PDF's first page, a
 * note's own `cover`. Anything else has none, and the card shows only its icon.
 *
 * A book or a PDF is read whole to find its picture, so each is found once per version of the
 * file and kept for the session; a failure is kept too, as no picture, rather than retried on
 * every redraw of the properties.
 */
import { loadPdfJs, TFile, type App } from 'obsidian'
import { EPUB } from '@/vendor/foliate-js/epub.js'
import { isZip, openZip } from '@/reader/zipLoader'
import { coverLink, resourceUrl } from '@/helpers/resourceUrl'
import { fileKind } from './values'
import { vaultUrl } from '@/helpers/vaultUrl'

/** Past this a file is not opened for its picture: a card is not worth reading 200 MB. */
const MAX_BYTES = 150 * 1024 * 1024
/** Wide enough for a card's thumbnail on a sharp screen, small enough to keep many of. */
const PAGE_WIDTH = 160

const found = new Map<string, Promise<string | null>>()
const objectUrls = new Set<string>()

/** A URL for the file's picture, or null when it has none. */
export function thumbnailOf(app: App, file: TFile): Promise<string | null> {
  const kind = fileKind(file.extension)
  if (kind === 'image') return Promise.resolve(vaultUrl(app, file))
  if (kind === 'note') {
    const cover = coverLink(app.metadataCache.getFileCache(file)?.frontmatter?.cover)
    return Promise.resolve(cover ? (resourceUrl(cover, file.path) ?? null) : null)
  }
  if (kind !== 'epub' && kind !== 'pdf') return Promise.resolve(null)
  if (file.stat.size > MAX_BYTES) return Promise.resolve(null)

  const key = `${file.path}|${file.stat.mtime}|${file.stat.size}`
  const known = found.get(key)
  if (known !== undefined) return known
  const pending = (kind === 'epub' ? epubCover(app, file) : pdfFirstPage(app, file)).catch(
    (err: unknown): null => {
      console.debug('[Abele] no picture for', file.path, err)
      return null
    }
  )
  found.set(key, pending)
  return pending
}

async function epubCover(app: App, file: TFile): Promise<string | null> {
  const data = new Uint8Array(await app.vault.readBinary(file))
  if (!isZip(data)) return null
  const zip = openZip(data)
  const book = await new EPUB({
    loadText: zip.loadText,
    loadBlob: zip.loadBlob,
    getSize: zip.getSize,
  }).init()
  const getCover = (book as unknown as { getCover?: () => Promise<Blob | null> }).getCover
  const blob = await getCover?.call(book)
  // Only a picture: a cover declared as anything else is not put in an <img>.
  if (!blob || !/^image\//.test(blob.type)) return null
  const url = URL.createObjectURL(blob)
  objectUrls.add(url)
  return url
}

interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number }
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): {
    promise: Promise<void>
  }
}

async function pdfFirstPage(app: App, file: TFile): Promise<string | null> {
  const lib = (await loadPdfJs()) as {
    getDocument?: (o: Record<string, unknown>) => {
      promise: Promise<{ getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> }>
    }
  }
  if (!lib?.getDocument) return null
  const data = new Uint8Array(await app.vault.readBinary(file))
  const pdf = await lib.getDocument({
    data,
    isEvalSupported: false,
    enableXfa: false,
    enableScripting: false,
    disableAutoFetch: true,
  }).promise
  try {
    const page = await pdf.getPage(1)
    const unit = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: PAGE_WIDTH / unit.width })
    const canvas = activeWindow.createEl('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) return null
    await page.render({ canvasContext: context, viewport }).promise
    return canvas.toDataURL('image/jpeg', 0.8)
  } finally {
    void pdf.destroy()
  }
}

/** Lets go of every picture made from a book, when the plugin unloads. */
export function forgetThumbnails(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
  found.clear()
}
