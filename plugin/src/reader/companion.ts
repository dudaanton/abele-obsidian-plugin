/**
 * The notes a book's highlights are kept in: where the settings send them, found again by what
 * they say.
 *
 * A book's highlights go to a note of its own — `<book> highlights.md` beside it, marked
 * `type: book-highlights` with a `file` link back (`book` in notes made before) — or to one note named in the settings, which
 * several books may share; each book may choose for itself (`notesTargetFor`). A note of the book's
 * own is found by that link rather than by its name, so it stays the book's when either file is
 * renamed or moved. In a shared note a book's highlights are the callouts whose place links to it.
 *
 * A template, when one is set, makes the note the first time, and its body is what each highlight
 * adds after that (`noteTemplate.ts`). Highlights written before the choice changed stay where they
 * are: the book still shows them, and they are changed and removed there.
 */
import { Notice, TFile, normalizePath, type App } from 'obsidian'
import { compare } from '@/vendor/foliate-js/epubcfi.js'
import { linkToPlace } from './bookLinks'
import { assignFileType } from '@/properties/types'
import {
  BOOK_LINK_KEY,
  BOOK_LINK_KEYS,
  HIGHLIGHTS_TYPE,
  highlightBlock,
  highlightLines,
  newHighlightsNote,
  parseHighlights,
  removeHighlight,
  upsertHighlight,
  withCompanionProps,
  type Highlight,
  type OfBook,
} from './highlights'
import {
  entryFrame,
  entryFrom,
  newNoteFrom,
  parseNoteTemplate,
  type NoteTemplate,
} from './noteTemplate'
import type { BookNotesTarget } from './settings'

/** What writing a book's highlights needs beyond the book: its name, and where they go. */
export interface NotesPlace {
  title: string
  author: string
  target: BookNotesTarget
}

/** Where a book's own highlights note is put when it is made. */
export function companionPath(book: TFile): string {
  const dir = book.parent && book.parent.path !== '/' ? `${book.parent.path}/` : ''
  return normalizePath(`${dir}${book.basename} highlights.md`)
}

/** The book's own highlights note, if there is one. */
export function findCompanion(app: App, book: TFile): TFile | null {
  const byName = app.vault.getAbstractFileByPath(companionPath(book))
  const matches = (file: TFile): boolean => {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter
    if (!fm || fm.type !== HIGHLIGHTS_TYPE) return false
    // `file` in notes made now, `book` in the ones made before: either says whose it is.
    return BOOK_LINK_KEYS.some((key) => {
      const value: unknown = fm[key]
      if (typeof value !== 'string') return false
      const linkpath = value
        .replace(/^\[\[|\]\]$/g, '')
        .split('|')[0]
        .split('#')[0]
        .trim()
      return app.metadataCache.getFirstLinkpathDest(linkpath, file.path)?.path === book.path
    })
  }
  if (byName instanceof TFile && matches(byName)) return byName
  for (const file of app.vault.getMarkdownFiles()) if (matches(file)) return file
  // A note of that name that has not been indexed yet, or lost its properties: still the one.
  return byName instanceof TFile ? byName : null
}

/** The note new highlights go to, if it is there yet; `own` is the book's own note, if found. */
function targetNote(
  app: App,
  book: TFile,
  where: NotesPlace,
  own = findCompanion(app, book)
): TFile | null {
  if (where.target.to === 'book') return own
  const file = app.vault.getAbstractFileByPath(normalizePath(where.target.path))
  return file instanceof TFile ? file : null
}

/**
 * Every note the book's highlights may be in — where new ones go first, then the book's own, then
 * the other notes the settings name — with which of its callouts are the book's: all of its own
 * note's, the ones linking to it elsewhere.
 */
function sources(app: App, book: TFile, where: NotesPlace): { note: TFile; ofBook?: OfBook }[] {
  const own = findCompanion(app, book)
  const out: { note: TFile; ofBook?: OfBook }[] = []
  const named = where.target.alsoIn.map((p) => app.vault.getAbstractFileByPath(normalizePath(p)))
  for (const note of [targetNote(app, book, where, own), own, ...named]) {
    if (!(note instanceof TFile)) continue
    if (out.some((s) => s.note.path === note.path)) continue
    out.push({ note, ofBook: note.path === own?.path ? undefined : linkingTo(app, book, note) })
  }
  return out
}

/** The callouts of a note that is not the book's own that are the book's: those linking to it. */
const linkingTo =
  (app: App, book: TFile, note: TFile): OfBook =>
  (target) =>
    target === book.path ||
    app.metadataCache.getFirstLinkpathDest(target, note.path)?.path === book.path

/** Every note the book's highlights may be in: where new ones go first, then the book's own. */
export function notesOf(app: App, book: TFile, where: NotesPlace): TFile[] {
  return sources(app, book, where).map((s) => s.note)
}

/** The book's highlights, from every note they are in; one place is one highlight. */
export async function readHighlights(
  app: App,
  book: TFile,
  where: NotesPlace
): Promise<Highlight[]> {
  const out: Highlight[] = []
  for (const { note, ofBook } of sources(app, book, where))
    for (const h of parseHighlights(await app.vault.cachedRead(note), ofBook))
      if (!out.some((x) => x.cfi === h.cfi)) out.push(h)
  return out
}

/** The note holding the highlight at `cfi`, with what it has there. */
async function holding(
  app: App,
  book: TFile,
  where: NotesPlace,
  cfi: string
): Promise<{ note: TFile; ofBook?: OfBook; found: Highlight } | null> {
  for (const { note, ofBook } of sources(app, book, where)) {
    const md = await app.vault.cachedRead(note)
    const found = parseHighlights(md, ofBook).find((h) => h.cfi === cfi)
    if (found) return { note, ofBook, found }
  }
  return null
}

/** The note to open for a highlight: the one it is in, else where new ones go. */
export async function noteFor(
  app: App,
  book: TFile,
  where: NotesPlace,
  cfi?: string
): Promise<TFile | null> {
  const held = cfi ? await holding(app, book, where, cfi) : null
  return held?.note ?? notesOf(app, book, where)[0] ?? null
}

/** The note holding the highlight at `cfi` and the lines its callout takes there; null if none. */
export async function highlightAt(
  app: App,
  book: TFile,
  where: NotesPlace,
  cfi: string
): Promise<{ note: TFile; lines: { from: number; to: number } } | null> {
  for (const { note, ofBook } of sources(app, book, where)) {
    const lines = highlightLines(await app.vault.cachedRead(note), cfi, ofBook)
    if (lines) return { note, lines }
  }
  return null
}

/** The template set, read; null when there is none, or it is not there — which is said. */
async function templateOf(app: App, where: NotesPlace): Promise<NoteTemplate | null> {
  const path = where.target.template
  if (!path) return null
  const file = app.vault.getAbstractFileByPath(normalizePath(path))
  if (!(file instanceof TFile)) {
    new Notice(`The highlights template ${path} is not there: the highlight is written without it.`)
    return null
  }
  return parseNoteTemplate(await app.vault.cachedRead(file))
}

/**
 * Writes a highlight: where it is already, or — a new one — where the settings send it, making the
 * note if there is none yet. `chatPath` is the file of the discussion it carries, if it carries
 * one, linked after its place.
 */
export async function saveHighlight(
  app: App,
  book: TFile,
  where: NotesPlace,
  h: Highlight,
  chatPath?: string
): Promise<TFile> {
  // In a note several books share, and no template to say whose it is, the link says.
  const title = where.title || book.basename
  const chapter = h.label.trim()
  const held = await holding(app, book, where, h.cfi)
  if (held) {
    // The label as the note has it: in a shared note it names the book too. Never none — a link
    // with no label reads as the book's file name and its place.
    const kept = { ...h, label: held.found.label || chapter || title }
    await write(app, book, held.note, held.ofBook, kept, chatPath)
    return held.note
  }
  const template = await templateOf(app, where)
  const own = where.target.to === 'book'
  const label = !chapter ? title : !own && !template ? `${title} · ${chapter}` : chapter
  const fresh = { ...h, label }
  const existing = targetNote(app, book, where)
  const path = existing?.path ?? (own ? companionPath(book) : normalizePath(where.target.path))
  const link = linkToPlace(app, book, { cfi: h.cfi }, fresh.label, path)
  const chat = fresh.discussion && chatPath ? chatLink(app, chatPath, path) : undefined
  // A wikilink whatever the link format: a property keeps its link tracked only as one.
  const bookLink = `[[${app.metadataCache.fileToLinktext(book, path, false)}]]`
  const vars = {
    title,
    author: where.author,
    book: bookLink,
    chapter: h.label,
    color: h.color,
    link,
    highlight: highlightBlock(fresh, link, chat),
  }
  if (existing) {
    // A book's own note without a template keeps its highlights in the order of the book; any
    // other grows at the end.
    const entry = own && !template ? undefined : entryFrom(template, vars)
    await write(
      app,
      book,
      existing,
      own ? undefined : linkingTo(app, book, existing),
      fresh,
      chatPath,
      entry
    )
    return existing
  }
  await ensureFolder(app, path)
  // The link back is a File property, drawn as the book's card.
  if (own) assignFileType(app, BOOK_LINK_KEY)
  if (template) {
    const md = newNoteFrom(template, vars)
    return app.vault.create(path, own ? withCompanionProps(md, bookLink) : md)
  }
  if (!own) return app.vault.create(path, `${vars.highlight}\n`)
  const note = await app.vault.create(path, newHighlightsNote(bookLink, book.basename))
  await write(app, book, note, undefined, fresh, chatPath)
  return note
}

/** The highlight written into `note`: in place of the one at its place, or added as `entry`. */
async function write(
  app: App,
  book: TFile,
  note: TFile,
  ofBook: OfBook | undefined,
  h: Highlight,
  chatPath?: string,
  entry?: string
): Promise<void> {
  const link = linkToPlace(app, book, { cfi: h.cfi }, h.label, note.path)
  const chat = h.discussion && chatPath ? chatLink(app, chatPath, note.path) : undefined
  await app.vault.process(note, (md) =>
    upsertHighlight(md, h, link, compare, chat, { ofBook, entry })
  )
}

/** The folders a new note's path needs, made. */
async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = path.split('/').slice(0, -1)
  for (let i = 1; i <= parts.length; i++) {
    const dir = parts.slice(0, i).join('/')
    if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)
  }
}

/** A link to a discussion's chat, the way the person's settings write links. */
function chatLink(app: App, path: string, from: string): string {
  const file = app.vault.getAbstractFileByPath(path)
  return file instanceof TFile
    ? app.fileManager.generateMarkdownLink(file, from, '', 'Discussion')
    : `[[${path}|Discussion]]`
}

/**
 * Removes a highlight from the note it is in; what the template wrote around it goes with it,
 * while it still reads as written.
 */
export async function deleteHighlight(
  app: App,
  book: TFile,
  where: NotesPlace,
  cfi: string
): Promise<void> {
  const held = await holding(app, book, where, cfi)
  if (!held) return
  const template = await templateOf(app, where)
  const frame = template ? entryFrame(template) : undefined
  await app.vault.process(held.note, (md) =>
    removeHighlight(md, cfi, { ofBook: held.ofBook, frame })
  )
}
