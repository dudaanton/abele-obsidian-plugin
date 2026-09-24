/**
 * The note a book's highlights are kept in: found by what it says it is, made when the first
 * highlight is.
 *
 * It is `<book> highlights.md` beside the book, marked `type: book-highlights` with a `book` link
 * back. It is found by that link rather than by its name, so it stays the book's when either file
 * is renamed or moved — Obsidian rewrites the link as the book moves.
 */
import { TFile, normalizePath, type App } from 'obsidian'
import { compare } from '@/vendor/foliate-js/epubcfi.js'
import { linkToPlace } from './bookLinks'
import {
  HIGHLIGHTS_TYPE,
  newHighlightsNote,
  parseHighlights,
  removeHighlight,
  upsertHighlight,
  type Highlight,
} from './highlights'

/** Where a book's highlights note is put when it is made. */
export function companionPath(book: TFile): string {
  const dir = book.parent && book.parent.path !== '/' ? `${book.parent.path}/` : ''
  return normalizePath(`${dir}${book.basename} highlights.md`)
}

/** The highlights note of `book`, if there is one. */
export function findCompanion(app: App, book: TFile): TFile | null {
  const byName = app.vault.getAbstractFileByPath(companionPath(book))
  const matches = (file: TFile): boolean => {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter
    if (!fm || fm.type !== HIGHLIGHTS_TYPE || typeof fm.book !== 'string') return false
    const linkpath = fm.book
      .replace(/^\[\[|\]\]$/g, '')
      .split('|')[0]
      .split('#')[0]
      .trim()
    return app.metadataCache.getFirstLinkpathDest(linkpath, file.path)?.path === book.path
  }
  if (byName instanceof TFile && matches(byName)) return byName
  for (const file of app.vault.getMarkdownFiles()) if (matches(file)) return file
  // A note of that name that has not been indexed yet, or lost its properties: still the one.
  return byName instanceof TFile ? byName : null
}

export async function readHighlights(app: App, book: TFile): Promise<Highlight[]> {
  const note = findCompanion(app, book)
  if (!note) return []
  return parseHighlights(await app.vault.cachedRead(note))
}

async function companionFor(app: App, book: TFile): Promise<TFile> {
  const found = findCompanion(app, book)
  if (found) return found
  const path = companionPath(book)
  // A wikilink whatever the link format: a property keeps its link tracked only as one.
  const bookLink = `[[${app.metadataCache.fileToLinktext(book, path, false)}]]`
  return app.vault.create(path, newHighlightsNote(bookLink, book.basename))
}

/** Writes a highlight into the book's note, making the note if there is none yet. */
export async function saveHighlight(app: App, book: TFile, h: Highlight): Promise<TFile> {
  const note = await companionFor(app, book)
  const link = linkToPlace(app, book, { cfi: h.cfi }, h.label, note.path)
  await app.vault.process(note, (md) => upsertHighlight(md, h, link, compare))
  return note
}

export async function deleteHighlight(app: App, book: TFile, cfi: string): Promise<void> {
  const note = findCompanion(app, book)
  if (note) await app.vault.process(note, (md) => removeHighlight(md, cfi))
}
