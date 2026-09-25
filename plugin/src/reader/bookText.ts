/**
 * A book or PDF read as text, for the agent: its sections, their names, their words, and the
 * places in them — without a tab. The file is opened the way the reader opens it (the same
 * cleaning, the same PDF.js) and kept for a few minutes, so reading a book a part at a time
 * does not parse it again for every part.
 */
import type { App, TFile } from 'obsidian'
import { joinIndir, fromRange } from '@/vendor/foliate-js/epubcfi.js'
import { textWalker } from '@/vendor/foliate-js/text-walker.js'
import { searchMatcher, type SearchExcerpt } from '@/vendor/foliate-js/search.js'
import type { FoliateBook, FoliateTocItem } from '@/vendor/foliate-js/view.js'
import type { OpenedBook } from './openBook'
import type { PdfBookExtras } from './pdfBook'
import { openBookFile } from './openFile'

export interface BookSectionInfo {
  index: number
  /** The chapter's name from the contents, or `Page N` in a PDF; empty for a nameless part. */
  label: string
  /** Characters of text, roughly: what reading it whole would cost. */
  size: number
}

export interface LoadedBook {
  file: TFile
  pdf: boolean
  book: FoliateBook & Partial<PdfBookExtras>
  title: string
  author: string
  sections: BookSectionInfo[]
  toc: { label: string; index: number; depth: number; cfi: string | null }[]
  destroy(): void
}

const KEEP_MS = 5 * 60_000
const KEEP_BOOKS = 3
const cache = new Map<string, { at: number; mtime: number; loaded: Promise<LoadedBook> }>()

/** A name out of a book's metadata, which may be a string, a list, or a name in several languages. */
export const nameOf = (value: unknown): string => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const v = value as { name?: unknown; [lang: string]: unknown }
    if (v.name) return nameOf(v.name)
    const first = Object.values(v)[0]
    return typeof first === 'string' ? first : ''
  }
  return ''
}

type Resolver = { resolveHref?: (href: string) => unknown }

async function indexOfHref(book: Resolver, href: string): Promise<number> {
  try {
    const r = (await book.resolveHref?.(href)) as { index?: number } | null
    return typeof r?.index === 'number' ? r.index : -1
  } catch {
    return -1
  }
}

async function load(app: App, file: TFile): Promise<LoadedBook> {
  const data = new Uint8Array(await app.vault.readBinary(file))
  const pdf = file.extension === 'pdf'
  const opened: OpenedBook = await openBookFile(file, data)
  const book = opened.book as LoadedBook['book']
  const toc: LoadedBook['toc'] = []
  const walk = async (items: FoliateTocItem[] | undefined, depth: number) => {
    for (const item of items ?? []) {
      const index = await indexOfHref(book as unknown, item.href)
      toc.push({ label: (item.label ?? '').trim(), index, depth, cfi: null })
      await walk(item.subitems, depth + 1)
    }
  }
  await walk(book.toc, 0)
  const sections = book.sections.map((s, index) => {
    const named = toc.find((t) => t.index === index)
    return {
      index,
      label: pdf ? `Page ${index + 1}` : (named?.label ?? ''),
      size: pdf ? 0 : s.size,
    }
  })
  return {
    file,
    pdf,
    book,
    title: nameOf(book.metadata?.title) || file.basename,
    author: nameOf(book.metadata?.author),
    sections,
    toc,
    destroy: () => opened.destroy(),
  }
}

/** The book, opened now or a moment ago; the cache holds the last few books read. */
export function loadBookText(app: App, file: TFile): Promise<LoadedBook> {
  const now = Date.now()
  for (const [path, entry] of cache)
    if (now - entry.at > KEEP_MS) {
      cache.delete(path)
      void entry.loaded.then((b) => b.destroy()).catch(() => {})
    }
  const hit = cache.get(file.path)
  if (hit && hit.mtime === file.stat.mtime) {
    hit.at = now
    return hit.loaded
  }
  const loaded = load(app, file)
  cache.set(file.path, { at: now, mtime: file.stat.mtime, loaded })
  loaded.catch(() => cache.delete(file.path))
  while (cache.size > KEEP_BOOKS) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    cache.delete(oldest[0])
    void oldest[1].loaded.then((b) => b.destroy()).catch(() => {})
  }
  return loaded
}

/** Forgets every book read, as the plugin unloads. */
export function forgetBookTexts(): void {
  for (const entry of cache.values()) void entry.loaded.then((b) => b.destroy()).catch(() => {})
  cache.clear()
}

const BLOCK =
  /^(p|div|h[1-6]|li|blockquote|pre|tr|dt|dd|figcaption|section|article|aside|br|hr|table)$/i

/** A part's text, blocks on lines of their own, and where each text node starts in it. */
export interface SectionText {
  text: string
  /** The CFI of the part's start: what a link to it points at. */
  cfi: string | null
  doc: Document | null
  /** Offsets of text nodes in `text`, in document order. */
  nodes: { node: Text; start: number }[]
}

export async function sectionText(loaded: LoadedBook, index: number): Promise<SectionText> {
  const section = loaded.book.sections[index]
  if (!section) throw new Error(`There is no part ${index + 1} in this book.`)
  if (loaded.pdf) {
    const text = (await loaded.book.pageText?.(index)) ?? ''
    return { text, cfi: section.cfi ?? null, doc: null, nodes: [] }
  }
  const doc = (await section.createDocument?.()) ?? null
  if (!doc?.body) return { text: '', cfi: null, doc, nodes: [] }
  let text = ''
  const nodes: SectionText['nodes'] = []
  const newline = () => {
    if (text && !text.endsWith('\n\n')) text += text.endsWith('\n') ? '\n' : '\n\n'
  }
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const value = (node.nodeValue ?? '').replace(/\s+/g, ' ')
      if (!value.trim() && (!text || /\s$/.test(text))) return
      nodes.push({ node: node as Text, start: text.length })
      text += text.endsWith('\n') || !text ? value.trimStart() : value
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    if (el.hasAttribute('hidden') || /^(script|style|head)$/i.test(el.localName)) return
    const block = BLOCK.test(el.localName)
    if (block) newline()
    for (const child of Array.from(el.childNodes)) visit(child)
    if (block) newline()
  }
  visit(doc.body)
  const range = doc.createRange()
  range.selectNodeContents(doc.body)
  range.collapse(true)
  const base = section.cfi ?? null
  return { text: text.trim(), cfi: base ? joinIndir(base, fromRange(range)) : null, doc, nodes }
}

/** Where in a part's text a range starts; 0 when it cannot be placed. */
export function offsetOf(part: SectionText, range: Range): number {
  const at = part.nodes.find((n) => n.node === range.startContainer)
  if (at) return Math.min(at.start + range.startOffset, part.text.length)
  // A range starting at an element: the first text node after its start.
  for (const n of part.nodes) {
    const probe = n.node.ownerDocument.createRange()
    probe.selectNode(n.node)
    if (probe.compareBoundaryPoints(Range.START_TO_START, range) >= 0) return n.start
  }
  return 0
}

export interface BookFind {
  index: number
  label: string
  /** A CFI of the words in a book; the page's own in a PDF. */
  cfi: string | null
  excerpt: SearchExcerpt
}

/** Every match of `query`, in the book's order, up to `max`; `total` counts past it. */
export async function searchBookText(
  loaded: LoadedBook,
  query: string,
  max: number
): Promise<{ finds: BookFind[]; total: number }> {
  const finds: BookFind[] = []
  let total = 0
  if (loaded.pdf && loaded.book.searchPages) {
    for await (const r of loaded.book.searchPages(query, () => false)) {
      if ('progress' in r) continue
      for (const item of r.items) {
        total++
        if (finds.length < max)
          finds.push({
            index: r.index,
            label: `Page ${r.index + 1}`,
            cfi: loaded.book.sections[r.index]?.cfi ?? null,
            excerpt: item.excerpt,
          })
      }
    }
    return { finds, total }
  }
  const matcher = searchMatcher(textWalker, { defaultLocale: 'en' })
  for (const [index, section] of loaded.book.sections.entries()) {
    const doc = await section.createDocument?.()
    if (!doc) continue
    for (const { range, excerpt } of matcher(doc, query)) {
      total++
      if (finds.length >= max) continue
      const base = section.cfi
      finds.push({
        index,
        label: loaded.sections[index]?.label ?? '',
        cfi: base ? joinIndir(base, fromRange(range)) : null,
        excerpt,
      })
    }
  }
  return { finds, total }
}
