import { readerSettingsFrom, type ReaderSettings } from './settings'

/** Compare JSON-shaped mutable settings without allocating a new normalized object each read. */
function same(a: unknown, b: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (seen.get(a) === b) return true
  seen.set(a, b)
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], seen)
  )
}

function snapshot(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {}
  seen.set(value, copy)
  for (const key of Object.keys(value))
    Object.defineProperty(copy, key, {
      value: snapshot((value as Record<string, unknown>)[key], seen),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  return copy
}

/**
 * Borrowed read-only values for runtime consumers. Editors must still use readerSettingsFrom
 * for their own mutable draft. Detect in-place edits, including nested scripts/book choices,
 * immediately: unrelated save versions and object identity are not correctness boundaries.
 */
export class ReaderSettingsCache {
  private entries = new WeakMap<object, { source: unknown; value: ReaderSettings }>()
  private empty: ReaderSettings | undefined

  constructor(private readonly normalize = readerSettingsFrom) {}

  read(stored?: Partial<ReaderSettings> | null): Readonly<ReaderSettings> {
    if (!stored) return (this.empty ??= this.normalize(stored))
    const cached = this.entries.get(stored)
    if (cached && same(stored, cached.source)) return cached.value
    const value = this.normalize(stored)
    this.entries.set(stored, { source: snapshot(stored), value })
    return value
  }
}
