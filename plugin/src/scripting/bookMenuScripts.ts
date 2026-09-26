/**
 * The scripts offered on words selected in a book, the person's own list: which ones, in what
 * order, under what name and icon. Kept under `reader.selectionScripts` in the settings.
 *
 * A script can also be put there by its own header (`// @book`); those follow the chosen ones,
 * by name, unless the list names them too and so gives them a place of their own.
 *
 * Everything here is pure, so what the bar shows is tested without an app.
 */
import type { ParsedScript } from './types'

/** A script put in the book menu by hand. */
export interface BookMenuScript {
  /** The script's name, as its header gives it. */
  script: string
  /** What the menu calls it; empty for the script's own name. */
  name: string
  /** A lucide icon; empty for the script's own, or a scroll. */
  icon: string
}

/** One script as the bar offers it. */
export interface BookMenuItem {
  /** The script's name, what is run. */
  script: string
  /** What it is called on the bar and in the menu. */
  label: string
  icon: string
  /** Put there in the settings, or by the script's own header. */
  by: 'setting' | 'header'
}

/** Up to this many scripts have a button each on the bar; more make one button with a menu. */
export const BOOK_BAR_BUTTONS = 3

/** The icon a script has on the bar when neither the list nor its header chose one. */
export const BOOK_SCRIPT_ICON = 'scroll-text'

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The list as stored, made whole: nameless and repeated entries dropped. */
export function bookMenuScriptsFrom(stored: unknown): BookMenuScript[] {
  if (!Array.isArray(stored)) return []
  const seen = new Set<string>()
  const out: BookMenuScript[] = []
  for (const raw of stored) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const script = text(r.script).trim()
    if (!script || seen.has(script)) continue
    seen.add(script)
    out.push({ script, name: text(r.name), icon: text(r.icon) })
  }
  return out
}

/**
 * What the bar offers, in order: the chosen scripts that still exist, then those whose header
 * says `@book` and the list leaves out, by name.
 */
export function bookMenu(all: ParsedScript[], chosen: BookMenuScript[]): BookMenuItem[] {
  const byName = new Map(all.map((s) => [s.meta.name, s]))
  const items: BookMenuItem[] = []
  for (const c of chosen) {
    const s = byName.get(c.script)
    if (!s) continue
    items.push({
      script: c.script,
      label: c.name.trim() || c.script,
      icon: c.icon || s.meta.icon || BOOK_SCRIPT_ICON,
      by: 'setting',
    })
  }
  const listed = new Set(chosen.map((c) => c.script))
  const headed = all
    .filter((s) => s.meta.book && !listed.has(s.meta.name))
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name))
  for (const s of headed) {
    items.push({
      script: s.meta.name,
      label: s.meta.name,
      icon: s.meta.icon || BOOK_SCRIPT_ICON,
      by: 'header',
    })
  }
  return items
}

/** Whether a script is on the book menu, and by what; null when it is not. */
export function bookMenuPlace(
  script: ParsedScript,
  chosen: BookMenuScript[]
): 'setting' | 'header' | null {
  if (chosen.some((c) => c.script === script.meta.name)) return 'setting'
  return script.meta.book ? 'header' : null
}

/** The list with `script` added at its end; unchanged when it is there already. */
export function withBookScript(chosen: BookMenuScript[], script: string): BookMenuScript[] {
  if (chosen.some((c) => c.script === script)) return chosen
  return [...chosen, { script, name: '', icon: '' }]
}

/** The list without `script`. */
export function withoutBookScript(chosen: BookMenuScript[], script: string): BookMenuScript[] {
  return chosen.filter((c) => c.script !== script)
}

/** The list with the entry at `idx` moved one place up or down; unchanged past either end. */
export function movedBookScript(
  chosen: BookMenuScript[],
  idx: number,
  by: -1 | 1
): BookMenuScript[] {
  const to = idx + by
  if (idx < 0 || idx >= chosen.length || to < 0 || to >= chosen.length) return chosen
  const out = [...chosen]
  ;[out[idx], out[to]] = [out[to], out[idx]]
  return out
}
