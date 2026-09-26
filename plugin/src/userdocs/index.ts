import gettingStarted from './getting-started.md?raw'
import groups from './groups.md?raw'
import tasks from './tasks.md?raw'
import logsAndJournals from './logs-and-journals.md?raw'
import finance from './finance.md?raw'
import timeTracking from './time-tracking.md?raw'
import templates from './templates.md?raw'
import aiChat from './ai-chat.md?raw'
import comments from './comments.md?raw'
import scripts from './scripts.md?raw'
import github from './github.md?raw'
import books from './books.md?raw'
import drawing from './drawing.md?raw'
import writing from './writing.md?raw'
import transfer from './transfer.md?raw'
import settings from './settings.md?raw'
import quickButton from './quick-button.md?raw'
import { slug } from '@/docs'

/**
 * The plugin's documentation for people, shown in a view of its own (`UserDocsView`).
 *
 * Not the agent reference in `src/docs/`: that one is written for a model at work — exact
 * property names, which tool to reach for, what not to do. These pages say what the plugin can
 * do for the person using it, in their words. The two overlap in subject and should not be
 * merged; see `docs/Agent reference.md` for the other one.
 *
 * One markdown file per page, in the order of the contents. A page is a `# Title` line, a
 * paragraph saying what is on it, then `## ` sections, which may hold `### ` ones. Links between
 * pages are ordinary markdown links to a page id, with a heading after `#` when they point into
 * one: `[Footer](groups#the-footer)`. `tests/unit/userDocs.test.ts` holds all of that, and
 * checks that every command and every settings tab is at least named somewhere.
 */

export interface UserDocHeading {
  /** Slugified title, the same rule the agent reference uses for its topic ids. */
  id: string
  title: string
  level: 2 | 3
}

export interface UserDocPage {
  id: string
  title: string
  /** The paragraph between the title and the first section. */
  summary: string
  /** The whole file, as written. */
  source: string
  /** The file with its paragraphs unwrapped — what is handed to Obsidian to render. */
  rendered: string
  headings: UserDocHeading[]
}

const FILES: [id: string, source: string][] = [
  ['getting-started', gettingStarted],
  ['groups', groups],
  ['tasks', tasks],
  ['logs-and-journals', logsAndJournals],
  ['finance', finance],
  ['time-tracking', timeTracking],
  ['templates', templates],
  ['ai-chat', aiChat],
  ['comments', comments],
  ['scripts', scripts],
  ['github', github],
  ['books', books],
  ['drawing', drawing],
  ['writing', writing],
  ['transfer', transfer],
  ['quick-button', quickButton],
  ['settings', settings],
]

/** Lines outside fenced code: a `#` in an example is not a heading. */
function proseLines(source: string): string[] {
  const out: string[] = []
  let fence: string | null = null
  for (const line of source.split('\n')) {
    const marker = /^(`{3,}|~{3,})/.exec(line)
    if (marker) {
      if (fence === null) fence = marker[1]
      else if (line.startsWith(fence)) fence = null
      out.push('')
      continue
    }
    out.push(fence === null ? line : '')
  }
  return out
}

function parse(id: string, source: string): UserDocPage {
  const lines = source.split('\n')
  const title = lines[0].replace(/^#\s*/, '').trim()
  const headings: UserDocHeading[] = []
  const summary: string[] = []
  let seenSection = false

  proseLines(source)
    .slice(1)
    .forEach((line) => {
      const heading = /^(#{2,3})\s+(.*)$/.exec(line)
      if (heading) {
        seenSection = true
        const text = heading[2].trim()
        headings.push({ id: slug(text), title: text, level: heading[1].length as 2 | 3 })
      } else if (!seenSection) {
        summary.push(line)
      }
    })

  return {
    id,
    title,
    summary: summary.join(' ').replace(/\s+/g, ' ').trim(),
    source,
    rendered: unwrap(source),
    headings,
  }
}

/**
 * The source with each paragraph and list item on one line.
 *
 * The files are wrapped at a hundred columns, and Obsidian draws a newline inside a paragraph as
 * a line break unless strict line breaks are on in the vault — which most are not. Code blocks,
 * tables, headings and quotes keep their lines; a line starting a list item, a heading, a table
 * row, a quote or a fence starts a new line; anything else continues the line before it.
 */
export function unwrap(source: string): string {
  const out: string[] = []
  let fence: string | null = null
  let joinable = false
  for (const line of source.split('\n')) {
    const marker = /^(`{3,}|~{3,})/.exec(line)
    if (fence !== null) {
      out.push(line)
      if (marker && line.startsWith(fence)) fence = null
      continue
    }
    if (marker) {
      fence = marker[1]
      out.push(line)
      joinable = false
      continue
    }
    const trimmed = line.trim()
    const blockStart = /^(#{1,6}\s|[-*+]\s|\d+\.\s|\||>)/.test(trimmed)
    if (!trimmed) {
      out.push(line)
      joinable = false
    } else if (joinable && !blockStart) {
      out[out.length - 1] += ' ' + trimmed
    } else {
      out.push(line)
      joinable = !/^(#{1,6}\s|\||>)/.test(trimmed)
    }
  }
  return out.join('\n')
}

export const USER_DOCS: UserDocPage[] = FILES.map(([id, source]) => parse(id, source))

export function findPage(id: string): UserDocPage | null {
  return USER_DOCS.find((page) => page.id === id) ?? null
}

export interface DocTarget {
  page: string
  /** A heading id on that page, or empty for its top. */
  heading: string
}

/**
 * Where a link in a page leads: `tasks`, `tasks#priority-and-labels`, or `#heading` on the page
 * it is written in. Null for anything that is not a page of these docs — a note of the vault,
 * a heading the page does not have — so the view can refuse it rather than open a note.
 */
export function resolveDocLink(href: string, from: string): DocTarget | null {
  const decoded = safeDecode(href.trim())
  const hash = decoded.indexOf('#')
  const pageId = (hash === -1 ? decoded : decoded.slice(0, hash)).replace(/\.md$/, '') || from
  const heading = hash === -1 ? '' : slug(decoded.slice(hash + 1))
  const page = findPage(pageId)
  if (!page) return null
  if (heading && !page.headings.some((h) => h.id === heading)) return null
  return { page: page.id, heading }
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** The page the documentation button on a settings tab opens. */
const SETTINGS_TAB_PAGES: Record<string, string> = {
  tasks: 'tasks',
  logs: 'logs-and-journals',
  journals: 'logs-and-journals',
  calendars: 'logs-and-journals',
  finance: 'finance',
  'time-tracking': 'time-tracking',
  ai: 'ai-chat',
  scripts: 'scripts',
  links: 'scripts',
  github: 'github',
  reader: 'books',
  transfer: 'transfer',
  'quick-button': 'quick-button',
  other: 'settings',
}

export function pageForSettingsTab(tabId: string): string {
  return SETTINGS_TAB_PAGES[tabId] ?? 'settings'
}

/** Markdown as the words a reader sees: links by their label, no emphasis, no table bars. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^(`{3,}|~{3,}).*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/^\s*(?:>|[-*] |\d+\. |\|)\s*/gm, '')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/^-{3,}.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface SnippetPart {
  text: string
  hit: boolean
}

export interface UserDocHit {
  page: string
  pageTitle: string
  /** The section the words are in, or empty for the page's opening paragraph. */
  heading: string
  headingTitle: string
  snippet: SnippetPart[]
  /** The words searched for, for marking them again once the page is on screen. */
  terms: string[]
}

interface Section {
  page: UserDocPage
  heading: UserDocHeading | null
  text: string
  lower: string
}

/** Every page cut at its headings, as plain text: what search reads. Built once, on first use. */
let sections: Section[] | null = null

function allSections(): Section[] {
  if (sections) return sections
  const built: Section[] = []
  for (const page of USER_DOCS) {
    const lines = page.source.split('\n').slice(1)
    const prose = proseLines(page.source).slice(1)
    let heading: UserDocHeading | null = null
    let buffer: string[] = []
    let index = 0
    const flush = () => {
      const text = plainText(buffer.join('\n'))
      if (text || heading) built.push({ page, heading, text, lower: text.toLowerCase() })
      buffer = []
    }
    lines.forEach((line, i) => {
      if (/^#{2,3}\s/.test(prose[i])) {
        flush()
        heading = page.headings[index++] ?? null
        return
      }
      buffer.push(line)
    })
    flush()
  }
  sections = built
  return built
}

export function searchTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 1)
    ),
  ]
}

/**
 * The sections holding every word of the query, best first.
 *
 * Words match at their start — `templ` finds "template" — because this is searched as the
 * person types. A section whose heading or page title holds a word ranks above one that only
 * mentions it, and one that mentions it often above one that mentions it once.
 */
export function searchUserDocs(query: string, limit = 30): UserDocHit[] {
  const terms = searchTerms(query)
  if (!terms.length) return []

  const scored: { section: Section; score: number; order: number }[] = []
  allSections().forEach((section, order) => {
    const title = `${section.page.title} ${section.heading?.title ?? ''}`.toLowerCase()
    let score = 0
    for (const term of terms) {
      const pattern = wordStart(term)
      const inTitle = pattern.test(title)
      const count = section.lower.match(new RegExp(pattern.source, 'g'))?.length ?? 0
      if (!inTitle && !count) return
      score += (inTitle ? 10 : 0) + Math.min(count, 5)
      if (section.heading && section.heading.title.toLowerCase().includes(term)) score += 10
    }
    scored.push({ section, score, order })
  })

  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.slice(0, limit).map(({ section }) => ({
    page: section.page.id,
    pageTitle: section.page.title,
    heading: section.heading?.id ?? '',
    headingTitle: section.heading?.title ?? '',
    snippet: snippet(section.text, terms),
    terms,
  }))
}

function wordStart(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}`, 'iu')
}

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const SNIPPET_BEFORE = 50
const SNIPPET_LENGTH = 170

/** A window of the text around the first word found, cut at spaces, the words marked. */
export function snippet(text: string, terms: string[]): SnippetPart[] {
  const lower = text.toLowerCase()
  let first = -1
  for (const term of terms) {
    const at = lower.search(wordStart(term))
    if (at !== -1 && (first === -1 || at < first)) first = at
  }

  let start = Math.max(0, first - SNIPPET_BEFORE)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space !== -1 && space < first) start = space + 1
  }
  let end = Math.min(text.length, start + SNIPPET_LENGTH)
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > start) end = space
  }

  const window = text.slice(start, end)
  const parts = markTerms(window, terms)
  if (start > 0) parts.unshift({ text: '…', hit: false })
  if (end < text.length) parts.push({ text: '…', hit: false })
  return parts
}

/** Splits text into the runs that match a term and the runs between them. */
export function markTerms(text: string, terms: string[]): SnippetPart[] {
  if (!terms.length || !text) return text ? [{ text, hit: false }] : []
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${[...terms]
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join('|')})`,
    'giu'
  )
  const parts: SnippetPart[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) parts.push({ text: text.slice(last, at), hit: false })
    parts.push({ text: match[0], hit: true })
    last = at + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false })
  return parts
}
