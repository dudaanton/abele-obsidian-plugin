/**
 * A book file of any format the reader takes, opened into a book the engine can draw.
 */
import { loadPdfJs, type TFile } from 'obsidian'
import { openEpub, BookFormatError, type OpenedBook } from './openBook'
import { openPdf } from './pdfBook'
import { formatOf, openOtherFormat } from './otherFormats'

export async function openBookFile(file: TFile, data: Uint8Array): Promise<OpenedBook> {
  const format = formatOf(file.extension)
  if (!format) throw new BookFormatError(`The reader does not open .${file.extension} files.`)
  if (format === 'epub') return openEpub(data)
  if (format === 'pdf') return openPdf(await loadPdfJs(), data)
  return openOtherFormat(format, file.name, data)
}
