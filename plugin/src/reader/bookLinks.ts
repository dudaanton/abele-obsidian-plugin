/**
 * Links to a place in a book or a PDF, the way links to lines work for notes: the place rides in
 * the link's subpath, where a heading would go.
 *
 * ```
 * [[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]]
 * [[Papers/Paper.pdf#page=4]]
 * ```
 *
 * A place in a book is its EPUB CFI without the `epubcfi(…)` wrapper, whose parentheses would end
 * a markdown link. The characters a link cannot carry — brackets, which a CFI uses for ids, `|`,
 * `#`, `%`, spaces and parentheses — are percent-encoded. A page of a PDF is `#page=N`, 1-based,
 * which is also what Obsidian's own PDF viewer reads. Without the plugin either link still opens
 * the file, only at its start.
 */
import type { App, TFile } from 'obsidian'

export type BookPlace = { cfi: string } | { page: number }

const ENCODE = /[[\]|#%^()\s]/g

/** A CFI's inside, made safe for a wikilink and a markdown link. */
export function encodeCfi(cfi: string): string {
  const inner = /^epubcfi\((.*)\)$/s.exec(cfi.trim())?.[1] ?? cfi.trim()
  return inner.replace(
    ENCODE,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  )
}

/** The subpath for a place: `#cfi=…` or `#page=N`. */
export function placeSubpath(place: BookPlace): string {
  return 'page' in place
    ? `#page=${Math.max(1, Math.round(place.page))}`
    : `#cfi=${encodeCfi(place.cfi)}`
}

const decode = (text: string): string => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** A subpath as a place; null for anything else — a heading, say. */
export function parsePlaceSubpath(subpath: string | undefined | null): BookPlace | null {
  const text = (subpath ?? '').trim().replace(/^#/, '')
  const cfi = /^cfi=(.+)$/s.exec(text)
  if (cfi) {
    const inner = decode(cfi[1]).trim()
    if (!/^\/\d/.test(inner)) return null
    return { cfi: `epubcfi(${inner})` }
  }
  // Obsidian's viewer writes `#page=3&selection=…`: the page is what is read here.
  const page = /^page=(\d+)(?:&.*)?$/.exec(text)
  if (page) return { page: Math.max(1, Number(page[1])) }
  return null
}

/** A link to a place in `file`, in the person's own link format, with a label when given. */
export function linkToPlace(
  app: App,
  file: TFile,
  place: BookPlace,
  label?: string,
  sourcePath = ''
): string {
  const alias = label
    ?.replace(/[[\]|#^\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return app.fileManager.generateMarkdownLink(
    file,
    sourcePath,
    placeSubpath(place),
    alias || undefined
  )
}

/** A quote from the book followed by a link to where it is. */
export function quoteWithLink(text: string, link: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, i, all) => line || (i > 0 && all[i - 1]))
  return `${lines.map((line) => `> ${line}`.trimEnd()).join('\n')}\n> — ${link}`
}
