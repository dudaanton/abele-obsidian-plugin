/**
 * Which lists under which notes are folded away.
 *
 * Kept per vault on this device (the app's local storage), not in settings: it is where the
 * reader left a note, like a scroll position, not a preference to carry to another device.
 * Only folds are written — a note nobody folded has no entry, so every list opens by default.
 */

/** The lists a note's footer can show, each folded on its own. */
export type FooterSection =
  | 'tasks'
  | 'calendar'
  | 'transactions'
  | 'time'
  | 'backlinks'
  | 'logs'
  | 'chats'

export const FOOTER_SECTIONS: readonly FooterSection[] = [
  'tasks',
  'calendar',
  'transactions',
  'time',
  'backlinks',
  'logs',
  'chats',
]

/** Note path → the sections folded under it. Insertion order is recency: oldest first. */
export type FoldState = Record<string, FooterSection[]>

/**
 * How many notes the record remembers. A note folded once and never opened again would
 * otherwise stay in it for ever; past this, the one touched longest ago is forgotten.
 */
export const FOLD_LIMIT = 500

export function isFolded(state: FoldState, path: string, section: FooterSection): boolean {
  return state[path]?.includes(section) ?? false
}

/** A new record with `section` of `path` folded or opened; the note becomes the most recent. */
export function setFolded(
  state: FoldState,
  path: string,
  section: FooterSection,
  folded: boolean
): FoldState {
  const rest = (state[path] ?? []).filter((s) => s !== section)
  const sections = folded ? [...rest, section] : rest
  const next: FoldState = {}
  for (const [key, value] of Object.entries(state)) if (key !== path) next[key] = value
  if (sections.length) next[path] = sections
  const keys = Object.keys(next)
  for (const key of keys.slice(0, Math.max(0, keys.length - FOLD_LIMIT))) delete next[key]
  return next
}

/** The record after a note moved; the same record when that note had nothing folded. */
export function renameFolds(state: FoldState, oldPath: string, newPath: string): FoldState {
  const sections = state[oldPath]
  if (!sections) return state
  const next: FoldState = {}
  for (const [key, value] of Object.entries(state)) {
    if (key === oldPath) next[newPath] = sections
    else if (key !== newPath) next[key] = value
  }
  return next
}

/** A stored value read back, keeping only what this module could have written. */
export function foldStateFrom(raw: unknown): FoldState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const state: FoldState = {}
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    const sections = value.filter((s): s is FooterSection =>
      FOOTER_SECTIONS.includes(s as FooterSection)
    )
    if (sections.length) state[path] = sections
  }
  return state
}
