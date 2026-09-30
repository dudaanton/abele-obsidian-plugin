/**
 * How the lists under a note were left, besides their folds (`footerFolds.ts`): how many pages
 * of each paged list were drawn, and which tasks showed their description. With the note's
 * place (`notePlaces`), it is what brings a reader back to the row they were on — the row is
 * only there to scroll to if the pages that held it are drawn again, and it is only at the same
 * spot if the tasks above it are opened as they were.
 *
 * Kept per vault on this device, like the folds. A list on its first page with no task open
 * leaves no entry.
 */
import { FOOTER_SECTIONS, type FooterSection } from './footerFolds'

export interface NoteFooterView {
  /** Pages drawn past the first, by list. */
  pages?: Partial<Record<FooterSection, number>>
  /** Tasks, by path, showing their description. */
  open?: string[]
  /** Earliest revealed timeline day, so a saved past-row anchor can be drawn again. */
  calendarStart?: string
}

/** Note path → how its lists were left. Insertion order is recency: oldest first. */
export type FooterViewState = Record<string, NoteFooterView>

/** Notes remembered; past this, the one touched longest ago is forgotten. */
export const FOOTER_VIEW_LIMIT = 500

/**
 * The most pages drawn again when a note opens. Paging is there so a note in a wide group opens
 * quickly; a reader who went this deep is brought back that far and no further.
 */
export const MAX_RESTORED_PAGES = 10

const isEmpty = (v: NoteFooterView) =>
  !(v.pages && Object.keys(v.pages).length) && !(v.open && v.open.length) && !v.calendarStart

export function timelineStartOf(state: FooterViewState, path: string): string | null {
  return state[path]?.calendarStart ?? null
}

export function setTimelineStart(
  state: FooterViewState,
  path: string,
  day: string | null
): FooterViewState {
  if (timelineStartOf(state, path) === day) return state
  const view = { ...state[path] }
  if (day) view.calendarStart = day
  else delete view.calendarStart
  return put(state, path, view)
}

/** A new record with `path`'s entry replaced; the note becomes the most recent. */
function put(state: FooterViewState, path: string, view: NoteFooterView): FooterViewState {
  const next: FooterViewState = {}
  for (const [key, value] of Object.entries(state)) if (key !== path) next[key] = value
  if (!isEmpty(view)) next[path] = view
  const keys = Object.keys(next)
  for (const key of keys.slice(0, Math.max(0, keys.length - FOOTER_VIEW_LIMIT))) delete next[key]
  return next
}

/** How many pages of `section` to draw when `path` opens: at least one, at most the limit. */
export function pagesOf(state: FooterViewState, path: string, section: FooterSection): number {
  const n = state[path]?.pages?.[section] ?? 1
  return Math.max(1, Math.min(MAX_RESTORED_PAGES, Math.floor(n)))
}

/** The record with `section` of `path` drawn to `pages` pages; one page leaves no entry. */
export function setPages(
  state: FooterViewState,
  path: string,
  section: FooterSection,
  pages: number
): FooterViewState {
  const current = state[path] ?? {}
  if ((current.pages?.[section] ?? 1) === pages) return state
  const rest = { ...current.pages }
  delete rest[section]
  if (pages > 1) rest[section] = pages
  return put(state, path, { ...current, pages: rest })
}

export function isOpen(state: FooterViewState, path: string, task: string): boolean {
  return state[path]?.open?.includes(task) ?? false
}

/** The record with `task` under `path` opened or closed. */
export function setOpen(
  state: FooterViewState,
  path: string,
  task: string,
  open: boolean
): FooterViewState {
  if (isOpen(state, path, task) === open) return state
  const current = state[path] ?? {}
  const rest = (current.open ?? []).filter((t) => t !== task)
  return put(state, path, { ...current, open: open ? [...rest, task] : rest })
}

/** The record after a note moved; the same record when nothing was kept for it. */
export function renameFooterView(
  state: FooterViewState,
  oldPath: string,
  newPath: string
): FooterViewState {
  const view = state[oldPath]
  if (!view) return state
  const next: FooterViewState = {}
  for (const [key, value] of Object.entries(state)) {
    if (key === oldPath) next[newPath] = view
    else if (key !== newPath) next[key] = value
  }
  return next
}

/** A stored value read back, keeping only what this module could have written. */
export function footerViewFrom(raw: unknown): FooterViewState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const state: FooterViewState = {}
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as { pages?: unknown; open?: unknown; calendarStart?: unknown }
    const view: NoteFooterView = {}
    if (v.pages && typeof v.pages === 'object') {
      const pages: Partial<Record<FooterSection, number>> = {}
      for (const [section, n] of Object.entries(v.pages as Record<string, unknown>))
        if (FOOTER_SECTIONS.includes(section as FooterSection) && typeof n === 'number' && n > 1)
          pages[section as FooterSection] = Math.floor(n)
      if (Object.keys(pages).length) view.pages = pages
    }
    if (Array.isArray(v.open)) {
      const open = v.open.filter((t): t is string => typeof t === 'string')
      if (open.length) view.open = open
    }
    if (typeof v.calendarStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.calendarStart))
      view.calendarStart = v.calendarStart
    if (!isEmpty(view)) state[path] = view
  }
  return state
}
