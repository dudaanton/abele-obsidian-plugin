/**
 * Whether a note is being opened at a place of someone's choosing — a heading or block a link
 * names, a search result, a backlink's line, a line a plugin scrolls to, the place the back
 * button returns to. Such an opening always wins over the place the note was left at.
 *
 * Obsidian carries that place in the ephemeral state handed to `setViewState`,
 * `setEphemeralState` or `openFile({ eState })`. Anything else in it — `focus`, `rename` for a
 * note just made — is no place, and the saved one may be put back.
 */
const TARGET_KEYS = ['subpath', 'line', 'scroll', 'match', 'cursor', 'startLoc', 'endLoc'] as const

export function isExplicitTarget(eState: unknown): boolean {
  if (!eState || typeof eState !== 'object') return false
  const s = eState as Record<string, unknown>
  return TARGET_KEYS.some((key) => {
    const v = s[key]
    if (v === undefined || v === null) return false
    // `subpath: ''` is the note itself, no place in it.
    return typeof v !== 'string' || v.length > 0
  })
}
