/** Source-independent selection-menu configuration. No launch or persistence dependencies. */
import type { ParsedScript } from './types'

export type SelectionMenuSurface = 'book' | 'chat'

/** Membership pins a script to this surface; overrides belong only to this list. */
export interface SelectionMenuScript {
  script: string
  /** Empty uses the script's name. */
  name: string
  /** Empty uses the header icon, then the default. */
  icon: string
}

export interface SelectionMenuItem {
  script: string
  label: string
  icon: string
  by: 'setting' | 'header'
}

export const SELECTION_SCRIPT_ICON = 'scroll-text'
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Keep the first entry of each nonempty name. Missing presentation fields use defaults. */
export function selectionMenuScriptsFrom(stored: unknown): SelectionMenuScript[] {
  if (!Array.isArray(stored)) return []
  const seen = new Set<string>()
  const out: SelectionMenuScript[] = []
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

const headed = (script: ParsedScript, surface: SelectionMenuSurface): boolean =>
  !!(surface === 'book' ? script.meta.book : script.meta.chatSelection)

/**
 * Settings own order/label/icon for this surface; unlisted header opt-ins follow by name.
 * Missing scripts are omitted, not deleted from settings. Neither surface reads the other's list.
 */
export function selectionMenu(
  all: ParsedScript[],
  chosen: SelectionMenuScript[],
  surface: SelectionMenuSurface
): SelectionMenuItem[] {
  const byName = new Map(all.map((s) => [s.meta.name, s]))
  const normalized = selectionMenuScriptsFrom(chosen)
  const items: SelectionMenuItem[] = []
  for (const c of normalized) {
    const s = byName.get(c.script)
    if (!s) continue
    items.push({
      script: c.script,
      label: c.name.trim() || c.script,
      icon: c.icon || s.meta.icon || SELECTION_SCRIPT_ICON,
      by: 'setting',
    })
  }
  const listed = new Set(normalized.map((c) => c.script))
  for (const s of [...byName.values()]
    .filter((s) => headed(s, surface) && !listed.has(s.meta.name))
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name))) {
    items.push({
      script: s.meta.name,
      label: s.meta.name,
      icon: s.meta.icon || SELECTION_SCRIPT_ICON,
      by: 'header',
    })
  }
  return items
}

export function selectionMenuPlace(
  script: ParsedScript,
  chosen: SelectionMenuScript[],
  surface: SelectionMenuSurface
): 'setting' | 'header' | null {
  if (chosen.some((c) => c.script === script.meta.name)) return 'setting'
  return headed(script, surface) ? 'header' : null
}

export function withSelectionScript(
  chosen: SelectionMenuScript[],
  script: string
): SelectionMenuScript[] {
  if (chosen.some((c) => c.script === script)) return chosen
  return [...chosen, { script, name: '', icon: '' }]
}

export function withoutSelectionScript(
  chosen: SelectionMenuScript[],
  script: string
): SelectionMenuScript[] {
  return chosen.filter((c) => c.script !== script)
}

export function movedSelectionScript(
  chosen: SelectionMenuScript[],
  idx: number,
  by: -1 | 1
): SelectionMenuScript[] {
  const to = idx + by
  if (idx < 0 || idx >= chosen.length || to < 0 || to >= chosen.length) return chosen
  const out = [...chosen]
  ;[out[idx], out[to]] = [out[to], out[idx]]
  return out
}
