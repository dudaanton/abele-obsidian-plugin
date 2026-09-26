/**
 * Places in a book read as text (`bookText.ts`), for the agent writing to it: a part's page as a
 * document, a range in it as the CFI a highlight is kept by and back again, the chapter a place is
 * in, and how far into the book it is. A PDF's pages are the documents its page frames hold, their
 * text layers filled (`pdfBook.ts`), so a place made here is a place the reader draws.
 */
import { fake, fromRange, joinIndir, parse, toRange } from '@/vendor/foliate-js/epubcfi.js'
import type { LoadedBook } from './bookText'

type Anchor = Range | Element | null
type CfiBook = { resolveCFI?: (cfi: string) => { index: number; anchor?: (d: Document) => Anchor } }
type TocBook = { getTOCFragment?: (doc: Document, id: string) => Node | null }

/** A part's own CFI: what every place in it starts with. A PDF page has the made-up kind. */
export const baseCfi = (loaded: LoadedBook, index: number): string =>
  loaded.book.sections[index]?.cfi ?? fake.fromIndex(index)

/** A part as a page document: a chapter as its file has it, a PDF page with its text layer. */
export async function pageDocument(loaded: LoadedBook, index: number): Promise<Document | null> {
  if (loaded.pdf) return (await loaded.book.pageDocument?.(index)) ?? null
  return (await loaded.book.sections[index]?.createDocument?.()) ?? null
}

/** The CFI of a range in part `index`'s page. */
export const cfiOf = (loaded: LoadedBook, index: number, range: Range): string =>
  joinIndir(baseCfi(loaded, index), fromRange(range))

/** The part a CFI is in; -1 when it is none of this book's. */
export function partOf(loaded: LoadedBook, cfi: string): number {
  const count = loaded.book.sections.length
  try {
    const found = (loaded.book as CfiBook).resolveCFI?.(cfi)
    if (found && typeof found.index === 'number') return found.index < count ? found.index : -1
  } catch {
    // Not a place this book's own reading knows: a PDF's, perhaps.
  }
  try {
    const parsed = parse(cfi) as { parent?: unknown[] } & unknown[]
    const head = (parsed.parent ?? parsed)[0]
    const index = fake.toIndex(head)
    return Number.isInteger(index) && index >= 0 && index < count ? index : -1
  } catch {
    return -1
  }
}

/** A place in a page, as a range of it; null when the page has no such place. */
export function rangeAt(loaded: LoadedBook, doc: Document, cfi: string): Range | null {
  const asRange = (anchor: Anchor): Range | null => {
    if (!anchor) return null
    if ('startContainer' in anchor) return anchor
    const range = doc.createRange()
    range.selectNodeContents(anchor)
    return range
  }
  try {
    const book = loaded.book as CfiBook
    if (book.resolveCFI) return asRange(book.resolveCFI(cfi)?.anchor?.(doc) ?? null)
    // A PDF: the steps after the page's own lead into its document.
    const parsed = parse(cfi) as { parent?: unknown[] } & unknown[]
    const steps = parsed.parent ?? parsed
    if (steps.length < 2) return null
    steps.shift()
    return toRange(doc, parsed)
  } catch {
    return null
  }
}

/** Whether `node` comes at or before where `range` starts. */
function before(doc: Document, node: Node, range: Range): boolean {
  const at = doc.createRange()
  at.setStartBefore(node)
  return at.compareBoundaryPoints(Range.START_TO_START, range) <= 0
}

/**
 * The chapter a range is in, as the reader names the place a highlight is made: the last entry of
 * the contents in that part starting before it, else the part's own name; `Page N` in a PDF.
 */
export async function labelAt(
  loaded: LoadedBook,
  index: number,
  doc: Document,
  range: Range
): Promise<string> {
  if (loaded.pdf) return `Page ${index + 1}`
  let label = loaded.sections[index]?.label ?? ''
  for (const entry of loaded.toc) {
    if (entry.index !== index) continue
    const hash = entry.href.indexOf('#')
    if (hash < 0) {
      label = entry.label
      continue
    }
    let id = entry.href.slice(hash + 1)
    try {
      id = decodeURIComponent(id)
    } catch {
      // Written by hand, with a stray `%`: the id as it is.
    }
    const el = (loaded.book as TocBook).getTOCFragment?.(doc, id) ?? doc.getElementById(id)
    if (el && before(doc, el, range)) label = entry.label
  }
  return label
}

/** How far into the book a place is, 0 to 1, by the parts' sizes: a bookmark's order. */
export function fractionAt(loaded: LoadedBook, index: number, within = 0): number {
  const sizes = loaded.book.sections.map((s) => Math.max(0, s.size || 0))
  const total = sizes.reduce((a, b) => a + b, 0)
  if (!total) return 0
  const done = sizes.slice(0, index).reduce((a, b) => a + b, 0)
  return Math.min(1, (done + (sizes[index] ?? 0) * Math.min(1, Math.max(0, within))) / total)
}
