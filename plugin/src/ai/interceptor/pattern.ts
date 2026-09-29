/**
 * Which messages an interceptor is shown.
 *
 * A pattern is a regular expression, written either bare (`^/todo\b`) or as a literal with flags
 * (`/^\/todo/i`). Empty means every message. It is tested against the text as typed; what is
 * attached is not part of it.
 */

/** The literal form: `/source/flags`, flags from the ones JavaScript knows. */
const LITERAL = /^\/(.+)\/([a-z]*)$/s

/** The pattern as a `RegExp`, or null when it is empty. Throws when it does not compile. */
function build(pattern: string): RegExp | null {
  const text = pattern.trim()
  if (!text) return null
  const literal = LITERAL.exec(text)
  // A fresh object per call: with `g` or `y` a shared one would carry `lastIndex` from one
  // message into the next, and answer differently for the same text.
  return literal ? new RegExp(literal[1], literal[2]) : new RegExp(text)
}

/** The compiled pattern, or null when it is empty or does not compile. */
export function compilePattern(pattern: string): RegExp | null {
  try {
    return build(pattern)
  } catch {
    return null
  }
}

/** Why the pattern does not compile, or null when it does (or is empty). */
export function patternError(pattern: string): string | null {
  try {
    build(pattern)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export interface PatternMatch {
  matches: boolean
  /** Set when the pattern does not compile: the interceptor is shown the message anyway. */
  broken?: string
}

/**
 * Whether a message goes to the interceptor.
 *
 * A pattern that does not compile answers yes. The interceptor may be a guard, and a typo in the
 * filter in front of it must not switch it off without a word; the caller says why instead.
 */
export function matchesPattern(pattern: string | undefined, text: string): PatternMatch {
  let re: RegExp | null
  try {
    re = build(pattern ?? '')
  } catch (err) {
    return { matches: true, broken: err instanceof Error ? err.message : String(err) }
  }
  if (!re) return { matches: true }
  return { matches: re.test(text) }
}
