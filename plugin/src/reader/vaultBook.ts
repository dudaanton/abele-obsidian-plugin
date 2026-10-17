import { loadPdfJs, type App, type TFile } from 'obsidian'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { vaultDisk } from '@/sync/vaultPathLinks'
import { openBookFile } from './openFile'
import { openEpubArchive, type OpenedBook } from './openBook'
import { openRangedZip } from './rangedZip'
import { openPdf } from './pdfBook'
import { openedOtherBook, formatOf } from './otherFormats'
import { makeComicBook } from '@/vendor/foliate-js/comic-book.js'
import { makeFB2 } from '@/vendor/foliate-js/fb2.js'
import { MOBI } from '@/vendor/foliate-js/mobi.js'
import { unzlibSync } from 'fflate'
import { BookFormatError } from './openBook'
import { sourceFile } from './sourceFile'
import { pdfSource } from './pdfSource'

/** A large book keeps a disk source alive only for the lifetime of its reader. */
export async function openVaultBook(app: App, file: TFile): Promise<OpenedBook> {
  const source = await new BoundedVaultIo(
    vaultDisk(app.vault),
    undefined,
    undefined,
    undefined,
    app.vault.configDir
  ).openRead(file.path)
  try {
    const format = formatOf(file.extension)
    if (source.size <= 50 * 1024 * 1024) {
      const data = new Uint8Array(await sourceFile(source).slice().arrayBuffer())
      await source.close()
      return await openBookFile(file, data)
    }
    let opened: OpenedBook
    if (format === 'epub' || format === 'cbz') {
      const zip = await openRangedZip(source)
      opened =
        format === 'epub' ? await openEpubArchive(zip) : openedOtherBook(makeComicBook(zip, file))
    } else if (format === 'pdf') {
      const lib = await loadPdfJs()
      opened = await openPdf(lib, pdfSource(source, lib))
    } else if (format === 'mobi') {
      const input = sourceFile(source)
      const header = new Uint8Array(await input.slice(0, 86).arrayBuffer())
      const offset = header.length >= 82 ? new DataView(header.buffer).getUint32(78) : 0
      const record = new Uint8Array(await input.slice(offset, offset + 16).arrayBuffer())
      const magic = new TextDecoder().decode(header.subarray(60, 68))
      if (
        ['BOOKMOBI', 'TEXtREAd'].includes(magic) &&
        record.length >= 14 &&
        new DataView(record.buffer).getUint16(12)
      )
        throw new BookFormatError('This book is protected by DRM, and the reader cannot open it.')
      opened = openedOtherBook(
        await new MOBI({ unzlib: unzlibSync }).open(input as unknown as Blob)
      )
    } else if (format === 'fb2') {
      opened = openedOtherBook(await makeFB2(sourceFile(source) as unknown as Blob))
    } else if (format === 'fbz') {
      const zip = await openRangedZip(source)
      const entry = zip.entries.find((one) => one.filename.toLowerCase().endsWith('.fb2'))
      const inner = entry && (await zip.loadBlob(entry.filename))
      if (!inner) throw new BookFormatError('There is no FB2 book in this archive.')
      opened = openedOtherBook(await makeFB2(inner))
    } else {
      throw new BookFormatError(`The reader does not open .${file.extension} files.`)
    }
    return {
      book: opened.book,
      destroy: () => {
        opened.destroy()
        void source.close()
      },
    }
  } catch (error) {
    await source.close()
    throw error
  }
}
