/**
 * A labels property: a list of words, added one at a time from those already used in the vault or
 * typed fresh, and taken off one at a time. The value is written as a list, as tasks read it best
 * (`helpers/taskMeta`); taking off the last one leaves the property empty.
 *
 * A label is compared the way tasks compare them — whatever its case, without a leading `#` — so
 * adding `Work` beside `work` changes nothing. Status labels (`todo`, `done`…) are labels too.
 */
import { labelKey, parseLabels } from '@/helpers/taskMeta'

/** The labels a value holds, one per entry, as they are shown. */
export function labelsOf(value: unknown): string[] {
  if (value == null) return []
  if (typeof value === 'string' && value.trim() === '') return []
  return parseLabels(value)
}

/** Whether a value is this widget's to draw: a label, a list of them, or nothing yet. */
export function isLabelsValue(value: unknown): boolean {
  if (value == null || typeof value === 'string') return true
  return Array.isArray(value) && value.every((v) => v == null || typeof v !== 'object')
}

const clean = (label: string) => label.trim().replace(/^#+/, '').trim()

/**
 * The entries as stored, kept as written — a label written as a link stays a link — with empty
 * ones dropped.
 */
function entriesOf(value: unknown): unknown[] {
  const entries = Array.isArray(value) ? value : [value]
  return entries.filter((e) => labelsOf(e).length > 0)
}

/** The stored list with `label` added at the end, or null when it is empty or already there. */
export function addLabel(value: unknown, label: string): unknown[] | null {
  const text = clean(label)
  if (!text) return null
  const key = labelKey(text)
  if (labelsOf(value).some((l) => labelKey(l) === key)) return null
  return [...entriesOf(value), text]
}

/** The stored list without `label`: null once nothing is left. */
export function removeLabel(value: unknown, label: string): unknown[] | null {
  const key = labelKey(label)
  const rest = entriesOf(value).filter((e) => !labelsOf(e).some((l) => labelKey(l) === key))
  return rest.length ? rest : null
}

/**
 * The labels worth offering: those the vault already uses (`known`, most used first), less those
 * the property holds, matching what is typed — words that start with it before words that only
 * contain it.
 */
export function suggestLabels(known: readonly string[], held: readonly string[], query: string) {
  const heldKeys = new Set(held.map(labelKey))
  const q = labelKey(clean(query))
  const free = known.filter((label) => !heldKeys.has(labelKey(label)))
  if (!q) return free
  const starts = free.filter((l) => labelKey(l).startsWith(q))
  const within = free.filter((l) => !labelKey(l).startsWith(q) && labelKey(l).includes(q))
  return [...starts, ...within]
}

/**
 * Every label in `values` — one per note, each a property's raw value — most used first, spelled
 * as first met.
 */
export function collectLabels(values: Iterable<unknown>): string[] {
  const counts = new Map<string, { label: string; count: number }>()
  for (const value of values) {
    for (const label of labelsOf(value)) {
      const key = labelKey(label)
      const entry = counts.get(key)
      if (entry) entry.count++
      else counts.set(key, { label, count: 1 })
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((e) => e.label)
}
