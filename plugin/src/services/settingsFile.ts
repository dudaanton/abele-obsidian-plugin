/**
 * What `AbeleConfig` needs to tell one settings file from another by what it says rather than
 * by how it is spelled.
 *
 * `data.json` syncs between devices and the later save wins. A device that wrote the file back
 * every time it read another device's copy — the same settings, serialised in another key order
 * or merely saved again on the way through a reload — would hand it straight back, and two
 * devices would pass it between them for ever. So the file is compared as *canonical JSON*: the
 * text `JSON.stringify` makes of it once every object's keys are sorted. Two files that say the
 * same thing give the same string, whatever order their keys were written in and whatever
 * whitespace was around them.
 */

/**
 * How long a reload waits before it looks at a file that would not parse a second time.
 *
 * Writes to the settings file are not atomic — Obsidian's adapter truncates and writes, and so
 * does the sync — so a reload that lands mid-write finds a short file. Half a second is far
 * longer than a write of a few kilobytes takes, and short enough that nobody sees the wait.
 */
export const UNREADABLE_RETRY_MS = 500

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

/** Whether a value read off disk is a settings object at all, rather than nothing or garbage. */
export function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms))
