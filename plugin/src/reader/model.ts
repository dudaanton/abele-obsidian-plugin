/**
 * What a book tab shows around the page — the contents, where the reader is, the note that is
 * open — as one reactive object the tab writes and its Vue side reads.
 */
import type { FoliateTocItem } from '@/vendor/foliate-js/view.js'
import type { SearchExcerpt } from '@/vendor/foliate-js/search.js'
import type { Highlight } from './highlights'
import type { BookFigure } from './figures'

/** Words selected on the page. */
export interface BookSelection {
  cfi: string
  text: string
  /** The chapter or page it is in. */
  label: string
}

/** One thing a search found: where, and the words around it. */
export interface SearchHit {
  /** A CFI in a book; a page's own CFI in a PDF, with which match on the page it is. */
  cfi: string
  occurrence?: number
  index?: number
  excerpt: SearchExcerpt
}

export interface SearchGroup {
  label: string
  hits: SearchHit[]
}

export interface BookSearch {
  query: string
  running: boolean
  /** 0 to 1, how much of the book has been searched. */
  progress: number
  groups: SearchGroup[]
  count: number
}

export type PanelTab = 'contents' | 'search' | 'highlights'

export const emptySearch = (): BookSearch => ({
  query: '',
  running: false,
  progress: 0,
  groups: [],
  count: 0,
})

export interface TocEntry {
  label: string
  href: string
  /** A key unique in the tree, for Vue and for finding the row again. */
  key: string
  children: TocEntry[]
}

export interface Footnote {
  /** The engine element showing the note, made by the engine; the dialog places it. */
  view: HTMLElement
  href: string
  /** `footnote`, `endnote`, `note`, `definition`, `biblioentry`, or null when only guessed. */
  type: string | null
}

export interface BookModel {
  /** A reflowing book, a PDF, or another book of fixed pages (a comic): which settings its dialog offers. */
  kind: 'epub' | 'pdf' | 'fixed'
  status: 'loading' | 'ready' | 'error'
  message: string
  title: string
  toc: TocEntry[]
  /** The contents entry of the page on screen. */
  currentHref: string | null
  /** The chapter name of the page on screen. */
  chapter: string
  /** How far into the book, 0 to 1. */
  fraction: number
  /** Whether the contents panel is open. */
  panel: boolean
  /** A link was followed inside the book, and there is a way back. */
  canGoBack: boolean
  footnote: Footnote | null
  settingsOpen: boolean
  /** Which list the side panel shows. */
  panelTab: PanelTab
  /** The book's highlights, as its highlights note has them. */
  highlights: Highlight[]
  /** Words selected on the page, with what can be done to them. */
  selection: BookSelection | null
  /** A highlight that was tapped, with what can be done to it. */
  active: Highlight | null
  /** A highlight whose comment is being written. */
  commenting: Highlight | null
  search: BookSearch
  /** The AI side is on, so "Ask here" is offered. */
  canAsk: boolean
  /** Reading aloud: playing, paused, or not at all. */
  speech: 'idle' | 'playing' | 'paused'
  /** A picture or a table opened full screen from the page. */
  figure: BookFigure | null
}

export const emptyBookModel = (): BookModel => ({
  kind: 'epub',
  status: 'loading',
  message: 'Opening the book…',
  title: '',
  toc: [],
  currentHref: null,
  chapter: '',
  fraction: 0,
  panel: false,
  canGoBack: false,
  footnote: null,
  settingsOpen: false,
  panelTab: 'contents',
  highlights: [],
  selection: null,
  active: null,
  commenting: null,
  search: emptySearch(),
  canAsk: false,
  speech: 'idle',
  figure: null,
})

/** The engine's contents as the tree the panel draws. */
export function tocEntries(items: FoliateTocItem[] | undefined, prefix = ''): TocEntry[] {
  return (items ?? []).map((item, i) => {
    const key = prefix ? `${prefix}.${i}` : String(i)
    return {
      label: (item.label ?? '').trim() || 'Untitled',
      href: item.href ?? '',
      key,
      children: tocEntries(item.subitems, key),
    }
  })
}

/** The keys of every entry on the way to the one with `href`, the entry's own included. */
export function pathTo(entries: TocEntry[], href: string | null): string[] {
  if (!href) return []
  for (const entry of entries) {
    if (entry.href === href) return [entry.key]
    const below = pathTo(entry.children, href)
    if (below.length) return [entry.key, ...below]
  }
  return []
}

/** "42%": how far into the book, rounded down so the end reads 100% only at the end. */
export function percent(fraction: number): string {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  return `${Math.floor(f * 100)}%`
}

/** A highlight's words, shortened for a list. */
export function shortText(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}
