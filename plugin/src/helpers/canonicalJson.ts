/**
 * The value as JSON with every object's keys in sorted order.
 *
 * JSON's own rules otherwise: `undefined` properties are left out, `toJSON` is honoured (the
 * replacer sees what it returned), and arrays keep their order, since in settings the order of
 * a list is part of what it says.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return inner
    const source = inner as Record<string, unknown>
    // `fromEntries` rather than assignment: a hand-edited file may hold a `__proto__` key, and
    // assigning it would set the copy's prototype instead of keeping the key.
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, source[key]])
    )
  })
}
