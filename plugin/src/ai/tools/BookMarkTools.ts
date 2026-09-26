/**
 * The book tools that mark a book: its highlights — listed, made on words the agent quotes,
 * recoloured, given a note, removed — and its bookmarks. They write where the reader writes, through
 * the same functions (`companion.ts`, `bookmarks.ts`), so what an agent marks is kept, drawn and
 * synced exactly as what a person marks, and an open book shows it as the note changes. The book
 * file itself is never written.
 */
import type { TFile } from 'obsidian'
import type { AgentTool } from '../client'
import { answer, app, link, namedBook, quoted } from './bookToolKit'
import { loadBookText, type LoadedBook } from '@/reader/bookText'
import { findQuote, MIN_QUOTE, nearest, quoteKey, wordsOf } from '@/reader/bookQuote'
import {
  baseCfi,
  cfiOf,
  fractionAt,
  labelAt,
  pageDocument,
  partOf,
  rangeAt,
} from '@/reader/bookRanges'
import {
  deleteHighlight,
  notesOf,
  readHighlights,
  saveHighlight,
  type NotesPlace,
} from '@/reader/companion'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '@/reader/highlights'
import { notesTargetFor, readerSettingsFrom } from '@/reader/settings'
import { bookKey } from '@/reader/positions'
import { bookBookmarks } from '@/reader/bookmarkFiles'
import type { BookPlace } from '@/reader/bookLinks'
import { AbeleConfig } from '@/services/AbeleConfig'
import { collapse, compare } from '@/vendor/foliate-js/epubcfi.js'

/** The longest quote a highlight is made of: a few paragraphs. */
const MAX_QUOTE = 5000
/** Places listed when a quote is found in several. */
const SHOW_CANDIDATES = 5
const LIST_LIMIT = 30

/** Text on one line, cut to `max` characters. */
const short = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

const keyOf = (loaded: LoadedBook) => bookKey(loaded.book.metadata?.identifier, loaded.file.path)

/** Where the book's highlights go, as the settings say now: what the reader asks too. */
function whereOf(loaded: LoadedBook): NotesPlace {
  const settings = readerSettingsFrom(AbeleConfig.getInstance().reader)
  return {
    title: loaded.title,
    author: loaded.author,
    target: notesTargetFor(settings, keyOf(loaded)),
  }
}

const colorFrom = (value: unknown): HighlightColor | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const c = value.trim().toLowerCase()
  if ((HIGHLIGHT_COLORS as readonly string[]).includes(c)) return c as HighlightColor
  throw new Error(`The colours are ${HIGHLIGHT_COLORS.join(', ')}.`)
}

/** The chat file a highlight's discussion is kept in, for its link to be written again. */
async function chatOf(h: Highlight): Promise<string | undefined> {
  if (!h.discussion) return undefined
  return (await import('@/reader/bookDiscussions')).discussionPath(h.discussion)
}

const pageOf = (loaded: LoadedBook, place: BookPlace): number =>
  'page' in place ? place.page - 1 : partOf(loaded, place.cfi)

/** The highlight a link names, in the book it names. */
async function namedHighlight(input: unknown) {
  const { file, place } = namedBook(input)
  if (!place || !('cfi' in place))
    throw new Error('Name the highlight by its link, as book_highlights lists it (#cfi=…).')
  const loaded = await loadBookText(app(), file)
  const where = whereOf(loaded)
  const all = await readHighlights(app(), file, where)
  const found = all.find((h) => h.cfi === place.cfi)
  if (!found) throw new Error('There is no highlight at that place; book_highlights lists them.')
  return { file, loaded, where, found }
}

const highlightLine = (file: TFile, h: Highlight) =>
  `${h.plain ? 'asked about' : h.color} ${link(file, { cfi: h.cfi }, h.label)}${h.discussion ? ' · has a discussion' : ''}`

export function createBookHighlightsTool(): AgentTool {
  return {
    name: 'book_highlights',
    label: 'Book highlights',
    description:
      "A book's highlights — each its colour, a link to its words (the id the other highlight tools take), the words, and the note on it — in the book's order, a page at a time, then its bookmarks with their ids. " +
      'Read-only; the book need not be open.',
    parameters: {
      type: 'object',
      properties: {
        book: { type: 'string', description: 'The book file: a vault path or a link' },
        color: { type: 'string', description: `Only this colour: ${HIGHLIGHT_COLORS.join(', ')}` },
        offset: {
          type: 'number',
          description: 'Highlights to pass over: the answer says the next',
        },
        limit: {
          type: 'number',
          description: `Highlights to list (default ${LIST_LIMIT}, at most 100)`,
        },
      },
      required: ['book'],
    },
    execute: async (_id, params) => {
      const { file } = namedBook(params.book)
      const color = colorFrom(params.color)
      const loaded = await loadBookText(app(), file)
      const where = whereOf(loaded)
      const all = (await readHighlights(app(), file, where))
        .filter((h) => !color || (h.color === color && !h.plain))
        .sort((a, b) => {
          try {
            return compare(a.cfi, b.cfi)
          } catch {
            return 0
          }
        })
      const offset = Math.max(0, Math.round(Number(params.offset) || 0))
      const limit = Math.min(100, Math.max(1, Math.round(Number(params.limit) || LIST_LIMIT)))
      const page = all.slice(offset, offset + limit)
      const notes = notesOf(app(), file, where).map((n) => n.path)
      const out = [
        all.length
          ? `${all.length} ${color ? `${color} ` : ''}highlight${all.length === 1 ? '' : 's'} in ${loaded.title}${all.length > page.length ? `; ${offset + 1}–${offset + page.length}` : ''}, kept in ${notes.join(' and ')}:`
          : `No ${color ? `${color} ` : ''}highlights in ${loaded.title} yet${notes.length ? '' : `; the first will make ${where.target.to === 'book' ? 'a note beside the book' : where.target.path}`}.`,
      ]
      page.forEach((h, i) => {
        out.push(`${offset + i + 1}. ${highlightLine(file, h)}`)
        out.push(quoted(short(h.text, 200)))
        if (h.comment) out.push(`   Note: ${short(h.comment, 300)}`)
      })
      if (offset + page.length < all.length)
        out.push(`[More: book_highlights with offset ${offset + page.length}.]`)
      const marks = (await bookBookmarks()?.list(keyOf(loaded))) ?? []
      if (marks.length) {
        out.push('', `Bookmarks: ${marks.length}`)
        for (const m of marks.slice(0, 20))
          out.push(`- ${m.id}: ${link(file, { cfi: m.cfi }, m.label)} — ${short(m.text, 80)}`)
      }
      return answer(out.join('\n'))
    },
  }
}

/** A place a quote was found at: its part, the page it is in, and the words. */
interface Found {
  index: number
  doc: Document
  range: Range
}

export function createBookHighlightTool(): AgentTool {
  return {
    name: 'book_highlight',
    label: 'Highlight in a book',
    description:
      'Highlights words in a book or PDF, with a colour and a note if one is given, exactly as the person would in the reader: kept in the same highlights note, shown in the book. ' +
      '`text` is the words exactly as book_read or book_search gives them (spacing and quote marks may differ, nothing else). ' +
      'Give `book` as a link to the place — a find of book_search, a place from book_read — to look there and choose the occurrence nearest it; a bare path searches the whole book (or `part`) and refuses words found in more than one place, listing where. ' +
      'The same words highlighted again change that highlight. A PDF needs its text layer: a scanned page has no words to highlight.',
    parameters: {
      type: 'object',
      properties: {
        book: { type: 'string', description: 'The book: a link to the place, or its path' },
        text: { type: 'string', description: 'The words to highlight, as the book has them' },
        part: { type: 'number', description: 'Only look in this part, from 1' },
        color: {
          type: 'string',
          description: `One of ${HIGHLIGHT_COLORS.join(', ')} (default yellow)`,
        },
        note: { type: 'string', description: 'A note kept with the highlight' },
      },
      required: ['book', 'text'],
    },
    execute: async (_id, params) => {
      const { file, place } = namedBook(params.book)
      const text = typeof params.text === 'string' ? params.text : ''
      if (quoteKey(text).length < MIN_QUOTE) throw new Error('Quote at least a few letters.')
      if (text.length > MAX_QUOTE)
        throw new Error(`Highlight at most ${MAX_QUOTE} characters at once.`)
      const color = colorFrom(params.color)
      const loaded = await loadBookText(app(), file)
      const count = loaded.sections.length
      let parts = [...Array(count).keys()]
      if (place) {
        const index = pageOf(loaded, place)
        if (index < 0 || index >= count) throw new Error('That place is not in this book.')
        parts = [index]
      } else if (typeof params.part === 'number') {
        const index = Math.round(params.part) - 1
        if (index < 0 || index >= count)
          throw new Error(`This book has parts 1 to ${count}; there is no part ${index + 1}.`)
        parts = [index]
      }
      const found: Found[] = []
      for (const index of parts) {
        const doc = await pageDocument(loaded, index)
        if (!doc) continue
        for (const range of findQuote(doc, text, 21)) found.push({ index, doc, range })
        if (found.length > 20) break
      }
      const within = parts.length === 1 ? `part ${parts[0] + 1}` : 'the book'
      if (!found.length)
        throw new Error(
          `These words are not in ${within}${loaded.pdf ? ' (a PDF page without a text layer has none)' : ''}. Quote them exactly as book_read gives them.`
        )
      let chosen: Found | undefined = found.length === 1 ? found[0] : undefined
      if (!chosen && place && 'cfi' in place) {
        const at = rangeAt(loaded, found[0].doc, place.cfi)
        const best = at
          ? nearest(
              found.map((f) => f.range),
              at
            )
          : null
        chosen = found.find((f) => f.range === best)
      }
      if (!chosen) {
        const lines = [
          `These words are in ${found.length > 20 ? 'more than 20' : found.length} places in ${within}. Give one of these links as \`book\`, or quote more words:`,
        ]
        for (const f of found.slice(0, SHOW_CANDIDATES)) {
          const label = await labelAt(loaded, f.index, f.doc, f.range)
          const around = f.range.startContainer.parentElement?.textContent ?? ''
          lines.push(
            `- part ${f.index + 1} ${link(file, { cfi: cfiOf(loaded, f.index, f.range) }, label)} — ${short(around, 120)}`
          )
        }
        throw new Error(lines.join('\n'))
      }
      const { index, doc, range } = chosen
      const cfi = cfiOf(loaded, index, range)
      // The place read back must be the words asked for, or a person's click would land elsewhere.
      const back = rangeAt(loaded, doc, cfi)
      if (!back || quoteKey(wordsOf(back)) !== quoteKey(text))
        throw new Error(
          'The words were found but could not be placed exactly; quote fewer of them.'
        )
      const where = whereOf(loaded)
      const known = (await readHighlights(app(), file, where)).find((h) => h.cfi === cfi)
      const h: Highlight = {
        cfi,
        color: color ?? known?.color ?? 'yellow',
        text: wordsOf(range),
        comment: typeof params.note === 'string' ? params.note.trim() : (known?.comment ?? ''),
        label: await labelAt(loaded, index, doc, range),
        ...(known?.discussion ? { discussion: known.discussion } : {}),
      }
      const note = await saveHighlight(app(), file, where, h, await chatOf(h))
      const out = [
        `${known ? 'Changed the highlight' : 'Highlighted'} in ${h.color}: ${link(file, { cfi }, h.label)}`,
        quoted(short(h.text, 300)),
        ...(h.comment ? [`   Note: ${short(h.comment, 300)}`] : []),
        `Kept in ${note.path}.`,
      ]
      return { ...answer(out.join('\n')), details: { path: note.path } }
    },
  }
}

export function createBookHighlightEditTool(): AgentTool {
  return {
    name: 'book_highlight_edit',
    label: 'Change a highlight',
    description:
      "Changes a book highlight's colour or its note: name it by its link, as book_highlights lists it. " +
      'An empty `note` removes the note. The words it covers stay; to cover other words, remove it and highlight again.',
    parameters: {
      type: 'object',
      properties: {
        highlight: { type: 'string', description: 'The highlight: its link' },
        color: { type: 'string', description: `One of ${HIGHLIGHT_COLORS.join(', ')}` },
        note: { type: 'string', description: 'The note in place of the one it has' },
      },
      required: ['highlight'],
    },
    execute: async (_id, params) => {
      const color = colorFrom(params.color)
      const note = typeof params.note === 'string' ? params.note.trim() : undefined
      if (!color && note === undefined) throw new Error('Give a colour, a note, or both.')
      const { file, where, found } = await namedHighlight(params.highlight)
      const h: Highlight = {
        ...found,
        color: color ?? found.color,
        comment: note ?? found.comment,
        // Words only asked about become a highlight when given a colour.
        ...(color ? { plain: undefined } : {}),
      }
      if (!h.plain) delete h.plain
      const saved = await saveHighlight(app(), file, where, h, await chatOf(h))
      return {
        ...answer(
          `Changed: ${highlightLine(file, h)}${h.comment ? `\n   Note: ${short(h.comment, 300)}` : ''}\nKept in ${saved.path}.`
        ),
        details: { path: saved.path },
      }
    },
  }
}

export function createBookHighlightRemoveTool(): AgentTool {
  return {
    name: 'book_highlight_remove',
    label: 'Remove a highlight',
    description:
      'Removes a book highlight — its callout in the highlights note and its mark in the book — named by its link, as book_highlights lists it. ' +
      'A highlight carrying a discussion (a chat about its words) is left for the person to remove in the reader, which asks what becomes of the chat.',
    parameters: {
      type: 'object',
      properties: {
        highlight: { type: 'string', description: 'The highlight: its link' },
      },
      required: ['highlight'],
    },
    execute: async (_id, params) => {
      const { file, where, found } = await namedHighlight(params.highlight)
      if (found.discussion)
        throw new Error(
          'This highlight carries a discussion; the person removes it in the reader, which asks whether to keep the chat.'
        )
      const note = notesOf(app(), file, where)[0]
      await deleteHighlight(app(), file, where, found.cfi)
      return {
        ...answer(`Removed the ${found.color} highlight on "${short(found.text, 120)}".`),
        ...(note ? { details: { path: note.path } } : {}),
      }
    },
  }
}

export function createBookBookmarkTool(): AgentTool {
  return {
    name: 'book_bookmark',
    label: 'Bookmark in a book',
    description:
      'Bookmarks a place in a book or PDF, as the bookmark button under the page does: give `book` as a link to the place (a find of book_search, `Paper.pdf#page=4`). ' +
      'Or removes one: `remove` with its id, as book_highlights lists them, and the book.',
    parameters: {
      type: 'object',
      properties: {
        book: { type: 'string', description: 'A link to the place, or the book when removing' },
        remove: { type: 'string', description: 'The id of a bookmark to remove' },
      },
      required: ['book'],
    },
    execute: async (_id, params) => {
      const store = bookBookmarks()
      if (!store) throw new Error('Bookmarks are not available: the book reader is not loaded.')
      const { file, place } = namedBook(params.book)
      const loaded = await loadBookText(app(), file)
      const key = keyOf(loaded)
      const marks = await store.list(key)
      const removing = typeof params.remove === 'string' ? params.remove.trim() : ''
      if (removing) {
        const mark = marks.find((m) => m.id === removing)
        if (!mark)
          throw new Error('This book has no bookmark with that id; book_highlights lists them.')
        await store.remove(key, mark.id)
        return answer(`Removed the bookmark at ${link(file, { cfi: mark.cfi }, mark.label)}.`)
      }
      if (!place) throw new Error('Give a link to the place to bookmark, not only the book.')
      const index = pageOf(loaded, place)
      if (index < 0 || index >= loaded.sections.length)
        throw new Error('That place is not in this book.')
      let cfi = baseCfi(loaded, index)
      let label = loaded.sections[index]?.label ?? ''
      let text = ''
      let fraction = fractionAt(loaded, index)
      if (loaded.pdf) text = (await loaded.book.pageText?.(index).catch(() => '')) ?? ''
      else if ('cfi' in place) {
        cfi = collapse(place.cfi)
        const doc = await pageDocument(loaded, index)
        const at = doc ? rangeAt(loaded, doc, cfi) : null
        if (doc && at) {
          label = await labelAt(loaded, index, doc, at)
          const rest = doc.createRange()
          rest.setStart(at.startContainer, at.startOffset)
          rest.setEndAfter(doc.body.lastChild ?? doc.body)
          text = wordsOf(rest)
          const all = (doc.body.textContent ?? '').length
          fraction = fractionAt(loaded, index, all ? 1 - rest.toString().length / all : 0)
        }
      }
      if (marks.some((m) => m.cfi === cfi))
        return answer(`That place is bookmarked already: ${link(file, { cfi }, label)}.`)
      const made = await store.add(key, { cfi, fraction, label, text: short(text, 200) })
      return answer(`Bookmarked ${link(file, { cfi }, label)} (id ${made.id}).`)
    },
  }
}

export function createBookMarkTools(): AgentTool[] {
  return [
    createBookHighlightsTool(),
    createBookHighlightTool(),
    createBookHighlightEditTool(),
    createBookHighlightRemoveTool(),
    createBookBookmarkTool(),
  ]
}
