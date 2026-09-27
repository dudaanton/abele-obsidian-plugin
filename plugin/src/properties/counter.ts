/**
 * A counter: a number property drawn with − and + beside it, for the property names listed in
 * the settings (`counterProperties`). The value stays a plain number in the frontmatter.
 *
 * An empty or missing value counts as 0, so + on a property just added gives 1. A number written
 * as text counts as that number. Anything else is not a counter's value: the row is left to
 * Obsidian and the buttons never write over it.
 */

/** The number a counter holds: 0 for an empty value, null for one that is not a number. */
export function counterValue(value: unknown): number | null {
  if (value == null) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** The value one step on, or null when the value is not a counter's to change. */
export function stepCounter(value: unknown, delta: number): number | null {
  const n = counterValue(value)
  if (n === null) return null
  // 0.1 + 1 is 1.1, not 1.1000000000000001.
  return Math.round((n + delta) * 1e9) / 1e9
}

/** The listed names, as Obsidian compares property names: trimmed, whatever their case. */
export function counterKeys(names: readonly string[]): Set<string> {
  return new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))
}

export function isCounterKey(key: string, keys: ReadonlySet<string>): boolean {
  return keys.has(key.trim().toLowerCase())
}
