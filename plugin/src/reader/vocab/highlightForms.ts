/**
 * Forms of a word kept with a highlight — the highlight's word underlined everywhere in its book
 * (`rules.ts`) — set from outside the reader: by a script (`vocabulary.mark({ highlight })`) or an
 * agent (`book_highlight`'s `forms`). Written where the reader writes highlights
 * (`companion.ts`), so the entry, its template field and an open book all follow.
 */
import type { App, TFile } from 'obsidian'
import type { LoadedBook } from '../bookText'
import { saveHighlight, readHighlights, noteFor, type NotesPlace } from '../companion'
import type { Highlight, HighlightColor } from '../highlights'
import { notesTargetFor, readerSettingsFrom } from '../settings'
import { bookKey } from '../positions'
import { AbeleConfig } from '@/services/AbeleConfig'
import { parseForms } from './words'

/** Where a book's highlights go, as the settings say now: what the reader asks too. */
export function notesPlaceOf(
  loaded: Pick<LoadedBook, 'book' | 'file' | 'title' | 'author'>
): NotesPlace {
  const settings = readerSettingsFrom(AbeleConfig.getInstance().reader)
  return {
    title: loaded.title,
    author: loaded.author,
    target: notesTargetFor(settings, bookKey(loaded.book.metadata?.identifier, loaded.file.path)),
  }
}

/**
 * Forms as a highlight will hold them: `given` added to what it has, each once, or — with
 * `replace` — in its place. Nothing given with `replace` means none.
 */
export function mergedForms(had: string[] | undefined, given: unknown, replace = false): string[] {
  const next = parseForms(given)
  return replace ? next : parseForms([...(had ?? []), ...next])
}

const same = (a: string[] | undefined, b: string[]) => JSON.stringify(a ?? []) === JSON.stringify(b)

/** A highlight to make when there is none at the place: its words and chapter. */
export interface NewHighlight {
  text: string
  label: string
  color?: HighlightColor
}

/**
 * Sets the forms of the highlight at `cfi` — made first from `make` when there is none there —
 * and writes it only when something changed. `wrote` is told the note before it is written.
 */
export async function setHighlightForms(
  app: App,
  book: TFile,
  where: NotesPlace,
  cfi: string,
  forms: unknown,
  opts: {
    replace?: boolean
    make?: NewHighlight
    wrote?: (path: string) => void
  } = {}
): Promise<{ highlight: Highlight; note: TFile | null; changed: boolean }> {
  const known = (await readHighlights(app, book, where)).find((h) => h.cfi === cfi)
  if (!known && !opts.make)
    throw new Error('There is no highlight at that place: make one first, or give its words.')
  const base: Highlight = known ?? {
    cfi,
    color: opts.make.color ?? 'yellow',
    text: opts.make.text,
    comment: '',
    label: opts.make.label,
  }
  const next = mergedForms(base.forms, forms, opts.replace)
  const h: Highlight = { ...base, forms: next.length ? next : undefined }
  if (!h.forms) delete h.forms
  if (known && same(known.forms, next))
    return { highlight: known, note: await noteFor(app, book, where, cfi), changed: false }
  const before = await noteFor(app, book, where, cfi)
  if (before) opts.wrote?.(before.path)
  // A discussion's chat stays linked from the highlight written again.
  const chat = h.discussion
    ? (await import('../bookDiscussions')).discussionPath(h.discussion)
    : undefined
  const note = await saveHighlight(app, book, where, h, chat)
  if (!before) opts.wrote?.(note.path)
  return { highlight: h, note, changed: true }
}
