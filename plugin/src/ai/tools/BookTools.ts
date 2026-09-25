/**
 * The book tools: read-only access to the books and PDFs in the vault, and to the book tabs the
 * person has open — what is on screen and selected, the contents, a part's text, a search — and
 * a way to put a place in front of them. A book is a file of the vault, so a chat reaches only
 * the books its scope lets it read, exactly as with notes.
 */
import { TFile, type App } from 'obsidian'
import type { AgentTool, AgentToolResult } from '../client'
import { ScopeResolver } from '../ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { BOOK_VIEW_TYPE, READER_EXTENSIONS } from '@/reader/viewType'
import type { BookView } from '@/reader/BookView'
import { linkToPlace, parsePlaceSubpath, type BookPlace } from '@/reader/bookLinks'
import { loadBookText, offsetOf, searchBookText, sectionText } from '@/reader/bookText'
import { percent } from '@/reader/model'

/** The most text one call hands back. */
const MAX_OUTPUT = 30_000
/** Characters of a part read when no limit is asked for. */
const DEFAULT_CHARS = 12_000
const MAX_CHARS = 25_000

const answer = (body: string): AgentToolResult => ({
  content: [
    {
      type: 'text',
      text:
        body.length > MAX_OUTPUT
          ? `${body.slice(0, MAX_OUTPUT)}\n\n[Cut at ${MAX_OUTPUT} characters — ask for a smaller part.]`
          : body,
    },
  ],
})

const app = (): App => GlobalStore.getInstance().app
const inScope = (path: string) => ScopeResolver.getInstance().isInScope(path)

/**
 * The book a call names: a vault path, or a link to a place in it (`[[Book.epub#cfi=…]]`,
 * `Book.epub#page=4`). The place comes back too. A book outside the chat's scope is refused.
 */
export function namedBook(input: unknown): { file: TFile; place: BookPlace | null } {
  let text = typeof input === 'string' ? input.trim() : ''
  if (!text) throw new Error('Name a book: its path in the vault, or a link to a place in it.')
  const wiki = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(text)
  const md = /^\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*\)$/.exec(text)
  text = wiki?.[1] ?? md?.[1] ?? text
  const hash = text.indexOf('#')
  const target = hash >= 0 ? text.slice(0, hash) : text
  const place = hash >= 0 ? parsePlaceSubpath(text.slice(hash)) : null
  let path = target
  try {
    path = decodeURIComponent(target)
  } catch {
    // A stray `%` written by hand: the path as it is.
  }
  const direct = app().vault.getAbstractFileByPath(path)
  const file = direct instanceof TFile ? direct : app().metadataCache.getFirstLinkpathDest(path, '')
  if (!(file instanceof TFile)) throw new Error(`No book at ${path}.`)
  if (!READER_EXTENSIONS.includes(file.extension))
    throw new Error(
      `${file.path} is not a book: the book tools read EPUB, PDF, MOBI, AZW3, FB2 and CBZ files.`
    )
  if (!inScope(file.path))
    throw new Error(`Access denied: ${file.path} is not in this chat's scope.`)
  return { file, place }
}

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

const link = (file: TFile, place: BookPlace, label?: string) =>
  linkToPlace(app(), file, place, label || file.basename)

const quoted = (text: string) =>
  text
    .split('\n')
    .map((line) => (line.trim() ? `   > ${line}` : '   >'))
    .join('\n')

export function createBookViewsTool(): AgentTool {
  return {
    name: 'book_views',
    label: 'Book tabs',
    description:
      "What the person is reading in book tabs (EPUB and PDF): each open book, which one is on screen, the chapter or page they are at and how far in, a link to that place, the words they have selected — quoted, with a link to them — the highlight they tapped, the discussions (chats kept with words, made with Ask here) on the page, and where the book's highlights note is. " +
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

export function createBookSearchTool(): AgentTool {
  return {
    name: 'book_search',
    label: 'Search book',
    description:
      'Searches the whole text of a book or PDF for words, ignoring case and accents. Each find comes with the words around it, which part or page it is in, and a link to exactly those words (a PDF: to the page). ' +
      'Read-only; the book need not be open.',
    parameters: {
      type: 'object',
      properties: {
        book: { type: 'string', description: 'The book file: a vault path or a link' },
        query: { type: 'string', description: 'The words to find' },
        limit: { type: 'number', description: 'Finds to list (default 30, at most 100)' },
      },
      required: ['book', 'query'],
    },
    execute: async (_id, params) => {
      const { file } = namedBook(params.book)
      const query = typeof params.query === 'string' ? params.query.trim() : ''
      if (query.length < 2) throw new Error('Search for at least two letters.')
      const max = Math.min(100, Math.max(1, Math.round((params.limit as number) || 30)))
      const loaded = await loadBookText(app(), file)
      const { finds, total } = await searchBookText(loaded, query, max)
      if (!total) return answer(`"${query}" is not in ${loaded.title}.`)
      const out = [
        `${total} find${total === 1 ? '' : 's'} of "${query}" in ${loaded.title}${total > finds.length ? `; the first ${finds.length}` : ''}:`,
        '',
      ]
      finds.forEach((f, i) => {
        const where = loaded.pdf ? { page: f.index + 1 } : { cfi: f.cfi ?? '' }
        out.push(
          `${i + 1}. ${f.label || `part ${f.index + 1}`} (part ${f.index + 1}) — ${link(file, where, f.label)}`
        )
        out.push(`   …${f.excerpt.pre}**${f.excerpt.match}**${f.excerpt.post}…`)
      })
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

export function createBookTools(): AgentTool[] {
  return [
    createBookViewsTool(),
    createBookContentsTool(),
    createBookReadTool(),
    createBookSearchTool(),
    createBookOpenTool(),
  ]
}
