/**
 * The book tools that read: the books and PDFs in the vault, and the book tabs the person has
 * open — what is there, what is on screen and selected, the contents, a part's text, a search of
 * the book or some of its parts — and a way to put a place in front of them. The tools that mark a
 * book are in `BookMarkTools.ts`. A book is a file of the vault, so a chat reaches only the books
 * its scope lets it read, exactly as with notes.
 */
import type { TFile } from 'obsidian'
import type { AgentTool } from '../client'
import { BOOK_VIEW_TYPE, READER_EXTENSIONS } from '@/reader/viewType'
import { bookPlaces } from '@/reader/places'
import type { BookPlace } from '@/reader/positions'
import type { BookView } from '@/reader/BookView'
import {
  DEFAULT_CHARS,
  MAX_CHARS,
  answer,
  app,
  inScope,
  link,
  namedBook,
  quoted,
  snippetOf,
} from './bookToolKit'
import { loadBookText, offsetOf, searchBookText, sectionText } from '@/reader/bookText'
import { percent } from '@/reader/model'
import { createBookMarkTools } from './BookMarkTools'

export { namedBook }

type Resolved = { index: number; anchor?: (doc: Document) => Range | Element | null } | null

/** The book's own reading of a place: which part it is in, and where in that part. */
const resolverOf =
  (book: unknown) =>
  (cfi: string): Resolved => {
    try {
      return (book as { resolveCFI?: (c: string) => Resolved }).resolveCFI?.(cfi) ?? null
    } catch {
      return null
    }
  }

export function createBookViewsTool(): AgentTool {
  return {
    name: 'book_views',
    label: 'Book tabs',
    description:
      "What the person is reading in book tabs (EPUB and PDF): each open book, which one is on screen, the chapter or page they are at and how far in, a link to that place, the words they have selected — quoted, with a link to them — the highlight they tapped, the discussions (chats kept with words, made with Ask here) on the page, where the book's highlights note is, and the pages they bookmarked, with links. " +
      'Call it first when they say "this book", "this passage", "here" or "what does this mean". Read-only.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      // Recognised by type rather than by class: the tools do not load the reader to look at it.
      const views = app()
        .workspace.getLeavesOfType(BOOK_VIEW_TYPE)
        .map((leaf) => leaf.view as unknown as BookView)
        .filter((view) => !!view.model)
      const shown = views.filter((v) => v.file && inScope(v.file.path))
      const hidden = views.length - shown.length
      if (!shown.length) {
        return answer(
          hidden
            ? `${hidden} book tab${hidden === 1 ? ' is' : 's are'} open, outside this chat's scope.`
            : 'No book is open. Ask which book, or open one at a place with book_open.'
        )
      }
      const out = [`${shown.length} book tab${shown.length === 1 ? '' : 's'} open.`, '']
      shown.forEach((view, i) => {
        const file = view.file
        const m = view.model
        const el = view.containerEl as HTMLElement & { isShown?: () => boolean }
        const marks = [
          el.isShown?.() ? 'on screen' : '',
          view.app.workspace.getMostRecentLeaf() === view.leaf ? 'used last' : '',
        ]
          .filter(Boolean)
          .join(', ')
        out.push(
          `${i + 1}. ${marks ? `[${marks}] ` : ''}${file.path}${m.kind === 'pdf' ? ' (PDF)' : ''}`
        )
        if (m.status !== 'ready') {
          out.push(
            `   ${m.status === 'error' ? `Could not be opened: ${m.message}` : 'Still opening.'}`
          )
          out.push('')
          return
        }
        out.push(`   At: ${m.chapter || 'the start'} — ${percent(m.fraction)} through`)
        try {
          if (view.reading) out.push(`   Here: ${view.reading.linkTo()}`)
        } catch {
          // No place yet: the book has not settled on a page.
        }
        const sel = m.selection ?? m.active
        if (sel) {
          const what = m.active ? `Highlight (${m.active.color})` : 'Selected'
          out.push(`   ${what}: ${link(file, { cfi: sel.cfi }, sel.label)}`)
          out.push(quoted(sel.text.slice(0, 8000)))
          if (m.active?.comment) out.push(`   Their comment: ${m.active.comment}`)
        }
        // Discussions held about words on this page: chats kept with those words.
        const talks = view.reading?.discussionsOnScreen() ?? []
        if (talks.length) {
          out.push(`   Discussions on this page: ${talks.length}`)
          for (const t of talks) {
            out.push(`   - ${link(file, { cfi: t.cfi }, t.label)} (chat ${t.discussion})`)
            out.push(quoted(t.text.slice(0, 600)).replace(/^ {3}/gm, '     '))
          }
        }
        const notes = view.reading?.notes().map((n) => n.path) ?? []
        out.push(
          notes.length
            ? `   Highlights: ${m.highlights.length}, kept in ${notes.join(' and ')}`
            : '   Highlights: none yet'
        )
        // Pages they marked to come back to; the ones on this page said so.
        const saved = m.bookmarks ?? []
        if (saved.length) {
          out.push(`   Bookmarks: ${saved.length}`)
          for (const b of saved.slice(0, 50))
            out.push(
              `   - ${link(file, { cfi: b.cfi }, b.label)}${m.bookmarksHere?.includes(b.id) ? ' (this page)' : ''}`
            )
        }
        out.push('')
      })
      if (hidden)
        out.push(
          `${hidden} more book tab${hidden === 1 ? '' : 's'} open outside this chat's scope.`
        )
      return answer(out.join('\n'))
    },
  }
}

export function createBookContentsTool(): AgentTool {
  return {
    name: 'book_contents',
    label: 'Book contents',
    description:
      "A book's title, author and table of contents, and its parts numbered as book_read takes them, with how long each is. For a PDF: its outline and page count. " +
      'The book is named by its path in the vault or a link to a place in it. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        book: { type: 'string', description: 'The book file: a vault path or a link' },
      },
      required: ['book'],
    },
    execute: async (_id, params) => {
      const { file } = namedBook(params.book)
      const loaded = await loadBookText(app(), file)
      const out = [
        `${loaded.title}${loaded.author ? ` — ${loaded.author}` : ''}`,
        `File: ${file.path}`,
      ]
      if (loaded.pdf) {
        out.push(`${loaded.sections.length} pages. book_read takes a page number as its part.`)
      } else {
        out.push(`${loaded.sections.length} parts (book_read's part numbers):`)
        for (const s of loaded.sections)
          out.push(
            `  ${s.index + 1}. ${s.label || '(unnamed)'} — about ${Math.round(s.size / 1000)}k characters`
          )
      }
      if (loaded.toc.length) {
        out.push('', 'Contents:')
        for (const t of loaded.toc)
          out.push(
            `${'  '.repeat(t.depth + 1)}${t.label}${t.index >= 0 ? ` → part ${t.index + 1}` : ''}`
          )
      } else out.push('', 'No table of contents.')
      return answer(out.join('\n'))
    },
  }
}

export function createBookReadTool(): AgentTool {
  return {
    name: 'book_read',
    label: 'Read book',
    description:
      'The text of a part of a book — a chapter file of an EPUB, a page of a PDF — a window at a time. ' +
      'Name the book by path and give `part` (numbered as book_contents lists them), or give a link to a place (`#cfi=…`, `#page=N`, as book_views, book_search and highlights give) to read from there. ' +
      '`offset` and `limit` are in characters; the answer says where the next window starts. Read-only; the book need not be open.',
    parameters: {
      type: 'object',
      properties: {
        book: { type: 'string', description: 'The book file, or a link to a place in it' },
        part: { type: 'number', description: 'Which part, from 1' },
        offset: { type: 'number', description: 'Character to start at within the part' },
        limit: {
          type: 'number',
          description: `Characters to return (default ${DEFAULT_CHARS}, at most ${MAX_CHARS})`,
        },
      },
      required: ['book'],
    },
    execute: async (_id, params) => {
      const { file, place } = namedBook(params.book)
      const loaded = await loadBookText(app(), file)
      let index = typeof params.part === 'number' ? Math.round(params.part) - 1 : -1
      let start = typeof params.offset === 'number' ? Math.max(0, Math.round(params.offset)) : 0
      let fromPlace: string | null = null
      if (index < 0 && place) {
        if ('page' in place) index = place.page - 1
        else {
          const resolved = resolverOf(loaded.book)(place.cfi)
          if (!resolved || resolved.index < 0) throw new Error('That place is not in this book.')
          index = resolved.index
          if (!loaded.pdf && typeof params.offset !== 'number') fromPlace = place.cfi
        }
      }
      if (index < 0) index = 0
      if (index >= loaded.sections.length)
        throw new Error(
          `This book has ${loaded.sections.length} parts; there is no part ${index + 1}.`
        )
      const part = await sectionText(loaded, index)
      if (fromPlace && part.doc) {
        const anchor = resolverOf(loaded.book)(fromPlace)?.anchor?.(part.doc)
        if (anchor) {
          const range = anchor instanceof Range ? anchor : part.doc.createRange()
          if (!(anchor instanceof Range)) range.selectNode(anchor)
          const at = offsetOf(part, range)
          // From the start of the paragraph the place is in, so the words come with their context.
          start = Math.max(0, part.text.lastIndexOf('\n', at) + 1)
        }
      }
      const limit = Math.min(
        MAX_CHARS,
        Math.max(500, Math.round((params.limit as number) || DEFAULT_CHARS))
      )
      const text = part.text.slice(start, start + limit)
      const end = start + text.length
      const label = loaded.sections[index]?.label
      const head = [
        `${loaded.title} — part ${index + 1} of ${loaded.sections.length}${label ? `: ${label}` : ''}`,
        `Link to this part: ${link(file, loaded.pdf ? { page: index + 1 } : { cfi: part.cfi ?? '' }, label)}`,
        `Characters ${start}–${end} of ${part.text.length}.`,
        '',
      ]
      const tail =
        end < part.text.length
          ? `\n\n[More in this part: book_read with part ${index + 1}, offset ${end}.]`
          : index + 1 < loaded.sections.length
            ? `\n\n[End of the part. The next is part ${index + 2}.]`
            : '\n\n[End of the book.]'
      return answer(head.join('\n') + (text || '(This part has no text.)') + tail)
    },
  }
}

/** Finds one search lists when no number is asked for, and the most it lists. */
const SEARCH_LIMIT = 15
const SEARCH_MAX = 40

/**
 * Part numbers written as a person would — `3`, `2-4`, `1, 5-7` — as indices from 0; refused
 * when one is not in the book.
 */
export function partsFrom(spec: unknown, count: number): Set<number> | undefined {
  const text = typeof spec === 'number' ? String(spec) : typeof spec === 'string' ? spec.trim() : ''
  if (!text) return undefined
  const out = new Set<number>()
  for (const piece of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(piece)
    if (!m) throw new Error(`"${piece}" is not a part number or a range of them, like 3 or 2-4.`)
    const from = Number(m[1])
    const to = Number(m[2] ?? m[1])
    if (from < 1 || to > count || from > to)
      throw new Error(`This book has parts 1 to ${count}; "${piece}" is not among them.`)
    for (let n = from; n <= to; n++) out.add(n - 1)
  }
  return out
}

export function createBookSearchTool(): AgentTool {
  return {
    name: 'book_search',
    label: 'Search book',
    description:
      'Searches the text of a book or PDF for words, ignoring case and accents: the whole book, or only the parts given in `parts` (numbered as book_contents lists them, e.g. "3" or "2-4, 7"). ' +
      `Each find is one short line of the words around it, the part it is in and a link to exactly those words (a PDF: to the page) — ${SEARCH_LIMIT} at a time; \`after\` continues from where the last page stopped. ` +
      'Read-only; the book need not be open.',
    parameters: {
      type: 'object',
      properties: {
        book: { type: 'string', description: 'The book file: a vault path or a link' },
        query: { type: 'string', description: 'The words to find' },
        parts: {
          type: 'string',
          description: 'Only these parts: a number, a range or a list ("3", "2-4, 7")',
        },
        after: {
          type: 'number',
          description: 'Finds already seen: the answer says what to pass for the next page',
        },
        limit: {
          type: 'number',
          description: `Finds to list (default ${SEARCH_LIMIT}, at most ${SEARCH_MAX})`,
        },
      },
      required: ['book', 'query'],
    },
    execute: async (_id, params) => {
      const { file } = namedBook(params.book)
      const query = typeof params.query === 'string' ? params.query.trim() : ''
      if (query.length < 2) throw new Error('Search for at least two letters.')
      const max = Math.min(
        SEARCH_MAX,
        Math.max(1, Math.round((params.limit as number) || SEARCH_LIMIT))
      )
      const skip = Math.max(0, Math.round(Number(params.after) || 0))
      const loaded = await loadBookText(app(), file)
      const parts = partsFrom(params.parts, loaded.sections.length)
      const { finds, total } = await searchBookText(loaded, query, max, { parts, skip })
      const where = parts
        ? ` in part${parts.size === 1 ? '' : 's'} ${[...parts].map((i) => i + 1).join(', ')}`
        : ''
      if (!total) return answer(`"${query}" is not in ${loaded.title}${where}.`)
      if (!finds.length)
        return answer(
          `${total} find${total === 1 ? '' : 's'} of "${query}"${where}; none after ${skip}.`
        )
      const shown = `${skip + 1}–${skip + finds.length}`
      const out = [
        `${total} find${total === 1 ? '' : 's'} of "${query}" in ${loaded.title}${where}${total > finds.length ? `; ${shown}` : ''}:`,
      ]
      finds.forEach((f, i) => {
        const place = loaded.pdf ? { page: f.index + 1 } : { cfi: f.cfi ?? '' }
        out.push(`${skip + i + 1}. part ${f.index + 1} ${link(file, place, f.label)}`)
        out.push(`   ${snippetOf(f.excerpt.pre, f.excerpt.match, f.excerpt.post)}`)
      })
      if (skip + finds.length < total)
        out.push(`[More: book_search with after ${skip + finds.length}.]`)
      return answer(out.join('\n'))
    },
  }
}

export function createBookOpenTool(): AgentTool {
  return {
    name: 'book_open',
    label: 'Show in a book',
    description:
      'Opens a book or PDF in front of the person at a place, with the words there selected: give a link as the other book tools write them (`[[Book.epub#cfi=…|…]]`, `Paper.pdf#page=4`), or a path to open it where they left it. ' +
      'It reuses the tab the book is open in.',
    parameters: {
      type: 'object',
      properties: {
        link: { type: 'string', description: "A link to a place, or the book's path" },
      },
      required: ['link'],
    },
    execute: async (_id, params) => {
      const { file, place } = namedBook(params.link)
      const workspace = app().workspace
      const existing = workspace
        .getLeavesOfType(BOOK_VIEW_TYPE)
        .find((l) => (l.view as unknown as { file?: TFile }).file?.path === file.path)
      const leaf = existing ?? workspace.getLeaf('tab')
      if (!existing)
        await leaf.setViewState({ type: BOOK_VIEW_TYPE, state: { file: file.path }, active: true })
      await workspace.revealLeaf(leaf)
      if (place) {
        const subpath =
          'page' in place
            ? `#page=${place.page}`
            : `#cfi=${place.cfi.replace(/^epubcfi\((.*)\)$/, '$1')}`
        leaf.setEphemeralState({ subpath })
      }
      return answer(
        `Opened ${file.path}${place ? ' at the place, with the words there selected' : ''}.`
      )
    },
  }
}

const LIST_LIMIT = 30

export function createBookListTool(): AgentTool {
  return {
    name: 'book_list',
    label: 'List books',
    description:
      'The books and PDFs in the vault this chat may read: path, how far the person has read and when, and whether it is open in a tab — the ones read last first. ' +
      '`query` keeps those whose path has all its words; a page at a time, `offset` for the next. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words the path must contain' },
        offset: { type: 'number', description: 'Books to pass over: the answer says the next' },
        limit: {
          type: 'number',
          description: `Books to list (default ${LIST_LIMIT}, at most 100)`,
        },
      },
    },
    execute: async (_id, params) => {
      const words = (typeof params.query === 'string' ? params.query : '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
      const all = app()
        .vault.getFiles()
        .filter((f) => READER_EXTENSIONS.includes(f.extension.toLowerCase()))
      const books = all.filter(
        (f) => inScope(f.path) && words.every((w) => f.path.toLowerCase().includes(w))
      )
      if (!books.length)
        return answer(
          all.length
            ? `No book${words.length ? ` matching "${words.join(' ')}"` : ''} in this chat's scope.`
            : 'There are no books or PDFs in the vault.'
        )
      const places =
        (await bookPlaces()
          ?.byPath()
          .catch((): null => null)) ?? new Map<string, BookPlace>()
      const open = new Set(
        app()
          .workspace.getLeavesOfType(BOOK_VIEW_TYPE)
          .map((l) => (l.view as unknown as { file?: TFile }).file?.path)
      )
      books.sort(
        (a, b) =>
          (places.get(b.path)?.at ?? 0) - (places.get(a.path)?.at ?? 0) ||
          a.path.localeCompare(b.path)
      )
      const offset = Math.max(0, Math.round(Number(params.offset) || 0))
      const limit = Math.min(100, Math.max(1, Math.round(Number(params.limit) || LIST_LIMIT)))
      const page = books.slice(offset, offset + limit)
      const out = [
        `${books.length} book${books.length === 1 ? '' : 's'}${books.length > page.length ? `; ${offset + 1}–${offset + page.length}` : ''}:`,
      ]
      for (const f of page) {
        const place = places.get(f.path)
        const read = place
          ? ` — ${percent(place.fraction)} read, last ${new Date(place.at).toISOString().slice(0, 10)}`
          : ''
        out.push(`- ${f.path}${read}${open.has(f.path) ? ' (open)' : ''}`)
      }
      if (offset + page.length < books.length)
        out.push(`[More: book_list with offset ${offset + page.length}.]`)
      return answer(out.join('\n'))
    },
  }
}

export function createBookTools(): AgentTool[] {
  return [
    createBookViewsTool(),
    createBookContentsTool(),
    createBookReadTool(),
    createBookSearchTool(),
    createBookOpenTool(),
    createBookListTool(),
    ...createBookMarkTools(),
  ]
}
