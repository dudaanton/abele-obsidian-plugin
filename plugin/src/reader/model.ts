/**
 * What a book tab shows around the page — the contents, where the reader is, the note that is
 * open — as one reactive object the tab writes and its Vue side reads.
 */
import type { FoliateTocItem } from '@/vendor/foliate-js/view.js'

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
}

export const emptyBookModel = (): BookModel => ({
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
