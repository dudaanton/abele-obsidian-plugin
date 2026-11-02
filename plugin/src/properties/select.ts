/**
 * A select property: one with a name listed in the settings, whose value is picked from that
 * list. What lands in the note is the option's name as plain text — a list of names when several
 * may be picked — so the note reads the same without the plugin and Obsidian's search and bases
 * keep working. An option may carry an icon, a colour and a line saying what it means; none of
 * that is written into notes.
 *
 * A value the list does not have (typed by hand, or an option since removed or renamed) is kept as
 * it is and shown as unknown, never dropped.
 */
import type { KitColor } from '@/constants/colors'

export interface SelectOption {
  /** What is written into the note and shown. */
  value: string
  /** A Lucide icon name, as the icon picker stores it. */
  icon?: string
  color?: KitColor
  description?: string
}

export interface SelectProperty {
  /** The property name, matched as Obsidian matches keys: whatever the case. */
  key: string
  /** Several options at once, written as a list. */
  multiple: boolean
  options: SelectOption[]
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The select property a key names, if any. */
export function selectFor(
  list: readonly SelectProperty[] | undefined,
  key: string
): SelectProperty | null {
  return list?.find((p) => p.key.trim() && same(p.key, key)) ?? null
}

/** The option a value names, whatever its case; null when the list has none. */
export function optionOf(property: SelectProperty, value: string): SelectOption | null {
  return property.options.find((o) => same(o.value, value)) ?? null
}

/** The names a value holds: none for an empty one, each item of a list, the text otherwise. */
export function selectValues(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value == null ? [] : [value]
  return items
    .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : ''))
    .filter((v) => v.trim().length > 0)
}

/** Whether a value can be drawn as a select: text, a number, a list of those, or nothing. */
export function isSelectValue(value: unknown): boolean {
  if (value == null || typeof value === 'string' || typeof value === 'number') return true
  return Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')
}

/** The value written after a pick: the name alone, or the list with it added. */
export function pick(property: SelectProperty, current: unknown, name: string): string | string[] {
  if (!property.multiple) return name
  const held = selectValues(current)
  return held.some((v) => same(v, name)) ? held : [...held, name]
}

/** The value written after one name is taken off: null when nothing is left. */
export function unpick(
  property: SelectProperty,
  current: unknown,
  name: string
): string | string[] | null {
  const rest = selectValues(current).filter((v) => !same(v, name))
  if (!rest.length) return null
  return property.multiple ? rest : rest[0]
}

/** The options to offer for what was typed, those already picked left out of a multiple one. */
export function offer(property: SelectProperty, current: unknown, query: string): SelectOption[] {
  const held = property.multiple ? selectValues(current) : []
  const q = query.trim().toLowerCase()
  return property.options.filter(
    (o) =>
      !held.some((v) => same(v, o.value)) &&
      (!q || o.value.toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q))
  )
}

/** Frontmatter as a vault holds it: the notes' properties, one object per note. */
export type FrontmatterSource = () => Iterable<Record<string, unknown> | undefined>

/** How many notes hold `value` under `key`. */
export function countUses(notes: FrontmatterSource, key: string, value: string): number {
  let count = 0
  for (const fm of notes()) {
    if (!fm) continue
    for (const k in fm)
      if (same(k, key) && selectValues(fm[k]).some((v) => same(v, value))) {
        count++
        break
      }
  }
  return count
}
